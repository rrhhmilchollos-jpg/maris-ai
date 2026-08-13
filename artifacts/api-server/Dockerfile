FROM node:22-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl git jq unzip zip \
    python3 python3-dev python3-pip python3-venv \
    build-essential pkg-config libssl-dev \
    && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm
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
