# ── Build stage ──────────────────────────────────────────────────────────────
FROM node:20-slim AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/appforge/package.json ./artifacts/appforge/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY scripts/package.json ./scripts/
COPY lib/db/package.json ./lib/db/
COPY lib/bundle-format/package.json ./lib/bundle-format/
COPY lib/api-client-react/package.json ./lib/api-client-react/
COPY lib/api-zod/package.json ./lib/api-zod/
COPY lib/api-spec/package.json ./lib/api-spec/
COPY lib/integrations-gemini-ai/package.json ./lib/integrations-gemini-ai/
COPY lib/integrations-anthropic-ai/package.json ./lib/integrations-anthropic-ai/
COPY lib/services/package.json ./lib/services/

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true

RUN npm install -g pnpm@10.11.0 --quiet
RUN pnpm install --no-frozen-lockfile --prefer-offline 2>/dev/null || pnpm install --no-frozen-lockfile

COPY . .
ARG CACHE_BUST=1
RUN pnpm --filter @workspace/api-server run build

# ── Runtime stage ─────────────────────────────────────────────────────────────
FROM node:20-slim AS runtime
WORKDIR /app

# Chromium + dependencias para Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libcups2 \
    dbus \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    wget \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Copiar node_modules raíz Y los de cada workspace (donde pnpm instala puppeteer)
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/artifacts/api-server/node_modules ./artifacts/api-server/node_modules
COPY --from=builder /app/artifacts/api-server/dist ./artifacts/api-server/dist
COPY --from=builder /app/artifacts/api-server/package.json ./artifacts/api-server/
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/package.json ./
COPY --from=builder /app/pnpm-workspace.yaml ./

ENV NODE_ENV=production
ENV NODE_PATH=/app/node_modules

COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

EXPOSE 8080

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "--enable-source-maps", "/app/artifacts/api-server/dist/index.mjs"]
