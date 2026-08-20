import { writeFile } from "node:fs/promises";
import { connectDB } from "../artifacts/api-server/src/lib/db";
import { GeneratedApp } from "@workspace/db/schema";

const appId = "6a863265e250d114f66ef6f2";
const output = process.env.SPAX_EXPORT_PATH || "/tmp/spax-frontend-bundle.txt";

async function main() {
  await connectDB();
  const app = await GeneratedApp.findById(appId).select("frontendCode contentVersion title").lean();
  if (!app?.frontendCode) throw new Error("SPAX bundle not found");
  await writeFile(output, String(app.frontendCode), "utf8");
  console.log(JSON.stringify({ appId, title: app.title, contentVersion: app.contentVersion ?? 0, output, bytes: String(app.frontendCode).length }));
  process.exit(0);
}

main().catch((error) => { console.error(error); process.exit(1); });
