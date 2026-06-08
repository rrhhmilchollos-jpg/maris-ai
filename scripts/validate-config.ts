import fs from 'fs';
import path from 'path';

const VERCEL_JSON_PATH = path.join(process.cwd(), 'vercel.json');
const APPFORGE_VERCEL_JSON_PATH = path.join(process.cwd(), 'artifacts/appforge/vercel.json');

function validateVercelJson(filePath: string) {
  if (!fs.existsSync(filePath)) {
    console.log(`⚠️  ${filePath} no encontrado, saltando...`);
    return true;
  }

  try {
    const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    let isValid = true;

    // 1. Verificar cabeceras de Content-Encoding prohibidas
    if (content.headers) {
      for (const headerGroup of content.headers) {
        if (headerGroup.headers) {
          for (const header of headerGroup.headers) {
            if (header.key.toLowerCase() === 'content-encoding') {
              console.error(`❌ ERROR: Cabecera 'Content-Encoding' detectada en ${filePath}. Esto causa errores de decodificación en producción.`);
              isValid = false;
            }
          }
        }
      }
    }

    // 2. Verificar rewrites para SPA
    if (content.rewrites) {
      const hasSpaFallback = content.rewrites.some((r: any) => r.source === '/(.*)' && (r.destination === '/index.html' || r.destination === '/'));
      if (!hasSpaFallback) {
        console.warn(`⚠️  ADVERTENCIA: No se detectó un fallback de SPA en ${filePath}. Las rutas internas podrían dar 404.`);
      }
    }

    return isValid;
  } catch (e) {
    console.error(`❌ ERROR: No se pudo parsear ${filePath}:`, e);
    return false;
  }
}

console.log('🔍 Iniciando validación de configuración...');
const rootValid = validateVercelJson(VERCEL_JSON_PATH);
const appforgeValid = validateVercelJson(APPFORGE_VERCEL_JSON_PATH);

if (!rootValid || !appforgeValid) {
  console.error('🛑 La validación falló. Corrige los errores antes de desplegar.');
  process.exit(1);
} else {
  console.log('✅ Configuración válida. Listo para el despliegue.');
}
