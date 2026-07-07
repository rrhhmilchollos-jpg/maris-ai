import fs from 'fs';
import path from 'path';

// NOTA: solo existe un vercel.json real (el de la raíz del repo) -- Vercel
// construye desde aquí (ver "outputDirectory": "artifacts/appforge/dist" y
// "buildCommand" en vercel.json, que solo tienen sentido si el Root
// Directory del proyecto en Vercel es la raíz del monorepo). Antes existían
// también artifacts/appforge/vercel.json y artifacts/api-server/vercel.json,
// pero eran archivos huérfanos que ningún despliegue real usaba -- se
// eliminaron para evitar exactamente el riesgo que representaban: que
// alguien edite la CSP/rewrites equivocados creyendo que sí tienen efecto.
const VERCEL_JSON_PATH = path.join(process.cwd(), 'vercel.json');

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
      const hasSpaFallback = content.rewrites.some((r: any) =>
        (r.source === '/(.*)' || /^\/\(\(\?!/.test(r.source || '')) &&
        (r.destination === '/index.html' || r.destination === '/')
      );
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

if (!rootValid) {
  console.error('🛑 La validación falló. Corrige los errores antes de desplegar.');
  process.exit(1);
} else {
  console.log('✅ Configuración válida. Listo para el despliegue.');
}
