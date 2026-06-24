# ── Build stage ──────────────────────────────────────────────────────────────
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

# Instalar Chromium en pasos separados para evitar OOM en Railway
# Paso 1: actualizar índices
RUN apt-get update

# Paso 2: instalar solo Chromium (trae sus dependencias automáticamente)
RUN apt-get install -y --no-install-recommends chromium

# Paso 3: fuentes y limpieza
RUN apt-get install -y --no-install-recommends \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/* /tmp/* /var/tmp/*

# Puppeteer usa el Chromium del sistema — no descarga el suyo
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copiar solo lo necesario para ejecutar el servidor
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

# Módulos de comunicación y self-monitoring
COPY --from=builder /app/communication ./communication
COPY --from=builder /app/self ./self

ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules

EXPOSE 8080

CMD ["node", "--enable-source-maps", "/app/artifacts/api-server/dist/index.mjs"]
