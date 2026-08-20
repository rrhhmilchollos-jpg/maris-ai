import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateBundle } from "../artifacts/api-server/src/lib/validate";
import { acquireAppMutationLease, commitAppMutation, releaseAppMutationLease } from "../artifacts/api-server/src/lib/appMutationGuard";
import { insertAppRevisionFromRow } from "../artifacts/api-server/src/lib/appRevisions";
import { AppMessage } from "@workspace/db/schema";

const appId = "6a863265e250d114f66ef6f2";
const bundlePath = process.env.SPAX_BUNDLE_PATH || "/tmp/spax-frontend-bundle.txt";
const jobId = `spax-v13-${randomUUID()}`;

async function main() {
  const frontendCode = await readFile(bundlePath, "utf8");
  const validation = await validateBundle(frontendCode);
  if (!validation.ok) throw new Error(`Bundle v13 rejected: ${JSON.stringify(validation.issues)}`);

  const locked = await acquireAppMutationLease({ appId, jobId });
  if (!locked.ok) throw new Error(`Cannot acquire SPAX mutation lease: ${locked.reason}`);

  try {
    await insertAppRevisionFromRow({
      row: locked.lease.app,
      source: "edit",
      summary: "Snapshot previo a SPAX v13: autenticación JWT, roles persistentes y sección institucional específica.",
      jobId,
    });

    const committed = await commitAppMutation({
      appId,
      jobId,
      expectedContentVersion: locked.lease.expectedContentVersion,
      update: {
        frontendCode,
        status: "ready",
        evaluatorSummary: "SPAX v13 validada: acceso del equipo por JWT y roles persistentes; contenido institucional actualizado con información pública verificada.",
      },
    });
    if (!committed.ok) throw new Error("SPAX mutation conflict: no changes persisted");

    await AppMessage.create({
      appId,
      role: "assistant",
      content: "Actualización v13 aplicada con snapshot: el acceso del equipo ya consulta el backend JWT de SPAX y la sección «Quiénes somos» refleja la información institucional pública de la asociación. Las cuentas se activan exclusivamente mediante invitación del administrador de SPAX.",
    });
    console.log(JSON.stringify({ ok: true, appId, previousVersion: locked.lease.expectedContentVersion, contentVersion: committed.app.contentVersion }));
    process.exit(0);
  } catch (error) {
    await releaseAppMutationLease({ appId, jobId });
    throw error;
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
