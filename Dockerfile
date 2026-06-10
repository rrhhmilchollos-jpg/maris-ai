# ── Build stage ──────────────────────────────────────────────────────────────
# node:20-slim reduce el tamaño de imagen ~60% respecto a node:20 (Debian full).
# Railway inyecta $PORT dinámicamente; Express lo lee de process.env.PORT.
FROM node:20-slim AS builder
WORKDIR /app

# Copiar manifiestos primero para aprovechar la caché de Docker layers
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/appforge/package.json ./artifacts/appforge/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY scripts/package.json ./scripts/
COPY lib/db/package.json ./lib/db/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/integrations-gemini-ai/package.json ./lib/integrations-gemini-ai/
COPY lib/integrations-anthropic-ai/package.json ./lib/integrations-anthropic-ai/
COPY lib/services/package.json ./lib/services/

RUN npm install -g pnpm@10.11.0 --quiet
RUN pnpm install --no-frozen-lockfile --prefer-offline 2>/dev/null || pnpm install --no-frozen-lockfile

COPY . .
ARG CACHE_BUST=1
RUN pnpm --filter @workspace/api-server run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Copiar solo lo necesario para ejecutar el servidor
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package.json ./

# Railway inyecta PORT dinámicamente; fallback a 7860 para Render/local
ENV PORT=7860
ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules

# Exponer el puerto (Railway lo sobreescribe con $PORT)
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://localhost:' + (process.env.PORT||7860) + '/api/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "--enable-source-maps", "/app/artifacts/api-server/dist/index.mjs"]
