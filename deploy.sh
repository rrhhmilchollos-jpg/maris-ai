#!/bin/bash
# Script de deploy para Maris AI
# Uso: VERCEL_TOKEN=xxx CLERK_KEY=xxx ./deploy.sh

set -e

VERCEL_TOKEN="${VERCEL_TOKEN:-}"
CLERK_KEY="${CLERK_KEY:-}"

if [ -z "$VERCEL_TOKEN" ] || [ -z "$CLERK_KEY" ]; then
  echo "ERROR: Debes definir VERCEL_TOKEN y CLERK_KEY"
  echo "Uso: VERCEL_TOKEN=xxx CLERK_KEY=pk_live_xxx ./deploy.sh"
  exit 1
fi

echo "Iniciando deploy de Maris AI..."

# Build frontend
echo "Construyendo frontend..."
VITE_CLERK_PUBLISHABLE_KEY="$CLERK_KEY" pnpm --filter @workspace/appforge build
echo "Build completado"

# Preparar output de Vercel
rm -rf .vercel/output
mkdir -p .vercel/output/static
cp -r artifacts/appforge/dist/. .vercel/output/static/

cat > .vercel/output/config.json << 'CFGEOF'
{
  "version": 3,
  "routes": [
    { "src": "/api/(.*)", "dest": "https://maris-ai-api-server-6c5u.onrender.com/api/$1" },
    {
      "src": "/(.*)", "dest": "/$1",
      "headers": {
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Resource-Policy": "cross-origin",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "SAMEORIGIN",
        "Referrer-Policy": "strict-origin-when-cross-origin"
      },
      "continue": true
    },
    { "src": "/assets/(.*)", "headers": { "Cache-Control": "public, max-age=31536000, immutable" }, "continue": true },
    { "handle": "filesystem" },
    { "src": "/(.*)", "dest": "/index.html" }
  ]
}
CFGEOF

echo "Desplegando en Vercel..."
vercel --token "$VERCEL_TOKEN" deploy --prebuilt --prod --yes
echo "Deploy completado!"
