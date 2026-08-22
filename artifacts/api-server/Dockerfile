FROM node:22-slim
WORKDIR /app
# Dependencias de sistema para Node, compilación y Chromium/Puppeteer. Sin las
# librerías de Chromium, el evaluador visual queda instalado pero no puede
# arrancar el navegador y deja escapar errores reales de runtime de React.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq unzip zip \
    python3 python3-dev python3-pip python3-venv \
    build-essential pkg-config libssl-dev \
    libasound2 libatk-bridge2.0-0 libatk1.0-0 libcairo2 libcups2 \
    libdbus-1-3 libdrm2 libexpat1 libgbm1 libglib2.0-0 libgtk-3-0 \
    libnspr4 libnss3 libpango-1.0-0 libpangocairo-1.0-0 libx11-6 \
    libx11-xcb1 libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 \
    libxkbcommon0 libxrandr2 fonts-liberation chromium \
    && rm -rf /var/lib/apt/lists/*
# Debe coincidir con packageManager del monorepo. Instalar "pnpm" sin versión
# cambia el comportamiento de seguridad entre builds y puede bloquear scripts
# ya aprobados por pnpm-workspace.yaml.
RUN npm install -g pnpm@10.11.0
COPY pnpm-lock.yaml package.json pnpm-workspace.yaml ./
COPY lib/ ./lib/
COPY artifacts/api-server/package.json ./artifacts/api-server/
RUN pnpm install --filter @workspace/api-server...
COPY artifacts/api-server/ ./artifacts/api-server/
# Paso crítico: Construir el proyecto
RUN pnpm --filter @workspace/api-server build
WORKDIR /app/artifacts/api-server
EXPOSE 3000
CMD ["pnpm", "start"]
