#!/usr/bin/env node

/**
 * download-app.ts
 * 
 * CLI para descargar apps compiladas desde Maris AI.
 * Uso: npx maris-cli download-app --app-id <id> --type <apk|aab|ios|web>
 */

import fs from "node:fs";
import path from "node:path";
import https from "node:https";
import { createWriteStream } from "node:fs";
import { argv } from "node:process";

interface DownloadOptions {
  appId: string;
  type: "apk" | "aab" | "ios" | "web";
  token?: string;
  output?: string;
  apiUrl?: string;
}

const API_BASE_URL = process.env.MARIS_API_URL || "https://maris-ai-api-server-production-fbad.up.railway.app";

/**
 * Parsea los argumentos de la línea de comandos
 */
function parseArgs(): DownloadOptions {
  const options: Partial<DownloadOptions> = {
    type: "apk",
    apiUrl: API_BASE_URL,
  };

  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    const nextArg = argv[i + 1];

    if (arg === "--app-id" && nextArg) {
      options.appId = nextArg;
      i++;
    } else if (arg === "--type" && nextArg) {
      options.type = nextArg as any;
      i++;
    } else if (arg === "--token" && nextArg) {
      options.token = nextArg;
      i++;
    } else if (arg === "--output" && nextArg) {
      options.output = nextArg;
      i++;
    } else if (arg === "--api-url" && nextArg) {
      options.apiUrl = nextArg;
      i++;
    } else if (arg === "--help" || arg === "-h") {
      showHelp();
      process.exit(0);
    }
  }

  if (!options.appId) {
    console.error("❌ Error: --app-id is required");
    showHelp();
    process.exit(1);
  }

  if (!options.token) {
    options.token = process.env.MARIS_TOKEN;
    if (!options.token) {
      console.error(
        "❌ Error: --token is required or set MARIS_TOKEN environment variable"
      );
      process.exit(1);
    }
  }

  return options as DownloadOptions;
}

/**
 * Muestra la ayuda
 */
function showHelp(): void {
  console.log(`
Maris AI - Download Compiled Apps

Usage:
  npx maris-cli download-app --app-id <id> [options]

Options:
  --app-id <id>        App ID (required)
  --type <type>        Download type: apk, aab, ios, web (default: apk)
  --token <token>      Authentication token (or set MARIS_TOKEN env var)
  --output <path>      Output file path (optional)
  --api-url <url>      API base URL (default: production)
  --help, -h           Show this help message

Examples:
  # Download APK
  npx maris-cli download-app --app-id abc123 --type apk

  # Download iOS project
  npx maris-cli download-app --app-id abc123 --type ios --output ~/Downloads/

  # Download web version
  npx maris-cli download-app --app-id abc123 --type web

Environment Variables:
  MARIS_TOKEN          Authentication token
  MARIS_API_URL        API base URL
  `);
}

/**
 * Construye la URL de descarga
 */
function buildDownloadUrl(opts: DownloadOptions): string {
  const baseUrl = opts.apiUrl || API_BASE_URL;

  switch (opts.type) {
    case "apk":
      return `${baseUrl}/api/mobile/apps/${opts.appId}/download-apk?type=debug`;
    case "aab":
      return `${baseUrl}/api/mobile/apps/${opts.appId}/download-aab`;
    case "ios":
      return `${baseUrl}/api/mobile/apps/${opts.appId}/download-xcode-project`;
    case "web":
      return `${baseUrl}/api/apps/${opts.appId}/download-web`;
    default:
      throw new Error(`Unknown download type: ${opts.type}`);
  }
}

/**
 * Obtiene el nombre del archivo por defecto
 */
function getDefaultFilename(opts: DownloadOptions): string {
  const timestamp = new Date().toISOString().split("T")[0];
  switch (opts.type) {
    case "apk":
      return `app-${opts.appId}-${timestamp}.apk`;
    case "aab":
      return `app-${opts.appId}-${timestamp}.aab`;
    case "ios":
      return `app-${opts.appId}-ios-${timestamp}.zip`;
    case "web":
      return `app-${opts.appId}-web-${timestamp}.zip`;
    default:
      return `app-${opts.appId}-${timestamp}`;
  }
}

/**
 * Descarga el archivo
 */
function downloadFile(
  url: string,
  outputPath: string,
  token: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    const options = {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    };

    console.log(`📥 Downloading from: ${url}`);
    console.log(`💾 Saving to: ${outputPath}`);

    const file = createWriteStream(outputPath);
    let downloadedBytes = 0;
    let totalBytes = 0;

    https
      .get(url, options, (response) => {
        // Verificar código de estado
        if (response.statusCode !== 200) {
          reject(
            new Error(
              `HTTP ${response.statusCode}: ${response.statusMessage}`
            )
          );
          return;
        }

        // Obtener tamaño total
        totalBytes = parseInt(response.headers["content-length"] || "0", 10);

        // Mostrar progreso
        response.on("data", (chunk) => {
          downloadedBytes += chunk.length;
          const percent = totalBytes
            ? ((downloadedBytes / totalBytes) * 100).toFixed(1)
            : "?";
          process.stdout.write(
            `\r⏳ Progress: ${downloadedBytes} / ${totalBytes} bytes (${percent}%)`
          );
        });

        response.pipe(file);
      })
      .on("error", (error) => {
        fs.unlink(outputPath, () => {});
        reject(error);
      });

    file.on("finish", () => {
      file.close();
      console.log("\n✅ Download completed successfully!");
      resolve();
    });

    file.on("error", (error) => {
      fs.unlink(outputPath, () => {});
      reject(error);
    });
  });
}

/**
 * Función principal
 */
async function main(): Promise<void> {
  try {
    const opts = parseArgs();

    console.log(`
╔════════════════════════════════════════╗
║   Maris AI - Download Compiled App     ║
╚════════════════════════════════════════╝
    `);

    console.log(`📱 App ID: ${opts.appId}`);
    console.log(`📦 Type: ${opts.type}`);

    // Construir URL de descarga
    const downloadUrl = buildDownloadUrl(opts);

    // Determinar ruta de salida
    const outputPath =
      opts.output ||
      path.join(process.cwd(), getDefaultFilename(opts));

    // Crear directorio si es necesario
    const outputDir = path.dirname(outputPath);
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Descargar archivo
    await downloadFile(downloadUrl, outputPath, opts.token!);

    // Mostrar información del archivo
    const stats = fs.statSync(outputPath);
    const sizeInMB = (stats.size / 1024 / 1024).toFixed(2);

    console.log(`
📊 File Information:
  - Size: ${sizeInMB} MB
  - Path: ${outputPath}
  - Type: ${opts.type.toUpperCase()}

✨ Your app is ready to use!
    `);

    if (opts.type === "apk") {
      console.log(`
📱 Next steps:
  1. Transfer the APK to your Android device
  2. Enable "Unknown sources" in Settings
  3. Open the APK file and install
  4. Launch the app!
    `);
    } else if (opts.type === "ios") {
      console.log(`
🍎 Next steps:
  1. Extract the ZIP file on your Mac
  2. Open the Xcode project
  3. Configure your Team ID in Xcode
  4. Build and run on simulator or device
    `);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`\n❌ Error: ${errorMsg}`);
    process.exit(1);
  }
}

// Ejecutar
main();
