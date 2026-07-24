/**
 * Migración única Clerk → Auth.js.
 *
 * Uso: pnpm --filter @workspace/api-server exec tsx src/scripts/migrateClerkToAuthjs.ts
 *
 * Hace dos cosas, en este orden:
 *
 * 1) UNIFICACIÓN DE userId DUPLICADO
 *    Si el mismo email tiene más de un documento en `users` (típicamente:
 *    uno con _id de texto de Clerk con todo el historial, y otro con
 *    ObjectId nativo creado a mano sin historial), se elige un _id
 *    canónico y se reescribe `userId` en TODAS las colecciones que lo
 *    referencian, apuntando al canónico. El documento de usuario perdedor
 *    se borra al final.
 *
 * 2) MARCAR CUENTAS MIGRADAS DESDE CLERK
 *    Todo usuario sin `passwordHash` (es decir, todos los que existían
 *    antes de este cambio) se marca con `needsPasswordReset: true`, ya que
 *    Clerk no permite exportar el hash original de la contraseña.
 *
 * Es seguro ejecutarlo más de una vez (es idempotente).
 */
import mongoose from "mongoose";
import { connectDB } from "../lib/db";
import { User } from "@workspace/db/schema";

// Todas las colecciones del monorepo que tienen un campo `userId` de tipo
// String apuntando al `_id` de `users`. Si añades una colección nueva con
// `userId`, añádela aquí también.
const COLLECTIONS_WITH_USER_ID = [
  "generatedapps",
  "credittransactions",
  "generationjobs",
  "visualtestjobs",
  "appmessages",
  "usernotifications",
  "appimages",
  "joblogs",
  "chatattachments",
  "agentmemories",
  "projectplaybooks",
  "appruntimeerrors",
  "panelruntimeerrors",
  "agentnotes",
  "apprevisions",
  "connectorcredentials",
  "videojobs",
];
// ⚠️ IMPORTANTE: antes de ejecutar esto en producción, verifica esta lista
// contra `mongoose.model<...>(...)` en lib/db/src/schema/index.ts — cualquier
// colección con `userId` que falte aquí no se reasignará y quedará huérfana
// apuntando al _id antiguo/perdedor.

async function unifyDuplicateUsers(email: string) {
  const db = mongoose.connection.db!;
  const users = await db
    .collection("users")
    .find({ email: email.toLowerCase() })
    .toArray();

  if (users.length <= 1) {
    console.log(`[unify] ${email}: sin duplicados (${users.length} doc).`);
    return;
  }

  console.log(`[unify] ${email}: ${users.length} documentos encontrados, eligiendo canónico...`);

  // Canónico = el que tenga más documentos referenciándolo en el resto de
  // colecciones (es decir, el que tiene el historial real).
  let best = { id: users[0]._id, count: -1 };
  for (const u of users) {
    let total = 0;
    for (const coll of COLLECTIONS_WITH_USER_ID) {
      total += await db.collection<any>(coll).countDocuments({ userId: String(u._id) });
    }
    console.log(`  - _id=${u._id} → ${total} documentos referenciados`);
    if (total > best.count) best = { id: u._id, count: total };
  }

  const canonicalId = String(best.id);
  const losers = users.map((u) => String(u._id)).filter((id) => id !== canonicalId);

  console.log(`[unify] Canónico elegido: ${canonicalId}. Reasignando desde: ${losers.join(", ")}`);

  for (const loserId of losers) {
    for (const coll of COLLECTIONS_WITH_USER_ID) {
      const result = await db
        .collection(coll)
        .updateMany({ userId: loserId }, { $set: { userId: canonicalId } });
      if (result.modifiedCount > 0) {
        console.log(`  - ${coll}: ${result.modifiedCount} documento(s) reasignados`);
      }
    }
    // Fusionar créditos del perdedor en el canónico antes de borrar, para no perder saldo.
    const loserDoc = users.find((u) => String(u._id) === loserId)!;
    if (loserDoc.credits) {
      await db
        .collection("users")
        .updateOne({ _id: best.id }, { $inc: { credits: loserDoc.credits } });
      console.log(`  - Créditos del perdedor (${loserDoc.credits}) sumados al canónico`);
    }
    await db.collection<any>("users").deleteOne({ _id: loserId });
    console.log(`  - Documento de usuario duplicado ${loserId} eliminado`);
  }
}

async function markUsersNeedingPasswordReset() {
  const result = await User.updateMany(
    { passwordHash: { $exists: false } },
    { $set: { needsPasswordReset: true } },
  );
  console.log(`[reset-flag] ${result.modifiedCount} usuario(s) marcados con needsPasswordReset: true`);
}

async function main() {
  await connectDB();

  const ownerEmail = process.env.ADMIN_EMAILS?.split(",")[0]?.trim() || "rrhh.milchollos@gmail.com";
  await unifyDuplicateUsers(ownerEmail);

  await markUsersNeedingPasswordReset();

  console.log("Migración completada.");
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Migración fallida:", err);
  process.exit(1);
});
