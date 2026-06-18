# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci

COPY ui ./ui
RUN npm run build:ui

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev
COPY bin ./bin
COPY src ./src
COPY --from=build /app/ui/dist ./ui/dist
COPY config.example.yaml ./config.example.yaml

RUN mkdir -p /app/data && chown -R node:node /app
USER node

ENV SMART_ROUTER_CONFIG=/app/config.yaml
EXPOSE 20129
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:20129/healthz').then((response) => process.exit(response.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "bin/9router-gateway.js"]
