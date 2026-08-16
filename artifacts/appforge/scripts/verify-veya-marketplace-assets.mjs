import { access, stat, readFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const assetDir = path.join(projectDir, "public", "assets", "veya-marketplace");
const pagePath = path.join(projectDir, "src", "pages", "veya.tsx");
const requiredAssets = [
  "vehicle-urban.jpg",
  "vehicle-suv.jpg",
  "vehicle-electric.jpg",
  "vehicle-commercial.jpg",
  "device-iphone.jpg",
  "device-galaxy.jpg",
  "device-pro.jpg",
  "device-android.jpg",
];

const page = await readFile(pagePath, "utf8");
if (page.includes('/veya/assets/veya-marketplace/')) {
  throw new Error("Marketplace Veya no debe usar /veya/assets: los recursos públicos se sirven desde /assets.");
}

for (const asset of requiredAssets) {
  const assetPath = path.join(assetDir, asset);
  await access(assetPath, constants.R_OK);
  const metadata = await stat(assetPath);
  if (metadata.size < 1024) throw new Error(`Activo Marketplace inválido o vacío: ${asset}`);
  if (!page.includes(`/assets/veya-marketplace/${asset}`)) {
    throw new Error(`El activo ${asset} existe pero no está referenciado por el catálogo Veya.`);
  }
}

console.log(`Veya Marketplace assets verified: ${requiredAssets.length}`);
