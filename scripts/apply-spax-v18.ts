import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { validateBundle } from "../artifacts/api-server/src/lib/validate";
import { acquireAppMutationLease, commitAppMutation, releaseAppMutationLease } from "../artifacts/api-server/src/lib/appMutationGuard";
import { insertAppRevisionFromRow } from "../artifacts/api-server/src/lib/appRevisions";
import { AppMessage } from "@workspace/db/schema";

const appId = "6a863265e250d114f66ef6f2";
const jobId = `spax-v18-${randomUUID()}`;

async function main() {
  const frontendCode = await readFile(process.env.SPAX_BUNDLE_PATH || "/tmp/spax-frontend-bundle.txt", "utf8");
  const validation = await validateBundle(frontendCode);
  if (!validation.ok) throw new Error(`Bundle v18 rejected: ${JSON.stringify(validation.issues)}`);
  const locked = await acquireAppMutationLease({ appId, jobId });
  if (!locked.ok) throw new Error(`Cannot acquire SPAX mutation lease: ${locked.reason}`);
  try {
    await insertAppRevisionFromRow({ row: locked.lease.app, source: "edit", summary: "Snapshot previo a SPAX v18: botón administrativo de exportación de auditoría CSV.", jobId });
    const committed = await commitAppMutation({
      appId,
      jobId,
      expectedContentVersion: locked.lease.expectedContentVersion,
      update: {
        frontendCode,
        status: "ready",
        evaluatorSummary: "SPAX v18 validada: administración puede descargar la auditoría CSV desde su panel autenticado.",
      },
    });
    if (!committed.ok) throw new Error("SPAX mutation conflict: no changes persisted");
    await AppMessage.create({ appId, role: "assistant", content: "SPAX v18 aplicada con snapshot. El panel de administración permite exportar el CSV de auditoría mediante la sesión autenticada; los demás roles no ven ese control." });
    console.log(JSON.stringify({ ok: true, previousVersion: locked.lease.expectedContentVersion, contentVersion: committed.app.contentVersion }));
    process.exit(0);
  } catch (error) {
    await releaseAppMutationLease({ appId, jobId });
    throw error;
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
