FROM node:20
WORKDIR /app
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
RUN npm install -g pnpm
RUN pnpm install --no-frozen-lockfile
COPY . .
ARG CACHE_BUST=1781044990
RUN pnpm --filter @workspace/api-server run build
EXPOSE 7860
ENV NODE_PATH=/app/node_modules
CMD ["node", "--enable-source-maps", "/app/artifacts/api-server/dist/index.mjs"]
