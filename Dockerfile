# syntax=docker/dockerfile:1.7
FROM node:22.18.0-bookworm-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable && corepack prepare pnpm@11.1.2 --activate
WORKDIR /workspace

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/mcp/package.json apps/mcp/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY packages/api-client/package.json packages/api-client/package.json
COPY packages/connectors/package.json packages/connectors/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/ui/package.json packages/ui/package.json
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG VITE_API_BASE_URL=http://localhost:8787
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN pnpm --filter @personal-os/api build \
 && pnpm --filter @personal-os/mcp build \
 && pnpm --filter @personal-os/web build \
 && pnpm --filter @personal-os/api deploy --prod --legacy /output/api \
 && pnpm --filter @personal-os/mcp deploy --prod --legacy /output/mcp

FROM node:22.18.0-bookworm-slim AS api
ENV NODE_ENV=production
ENV MIGRATIONS_DIR=/app/migrations
WORKDIR /app
ADD --chown=node:node --chmod=0444 \
  --checksum=sha256:e5bb2084ccf45087bda1c9bffdea0eb15ee67f0b91646106e466714f9de3c7e3 \
  https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
  /app/aws-rds-global-bundle.pem
COPY --from=build --chown=node:node /output/api ./
COPY --from=build --chown=node:node /workspace/packages/database/migrations ./migrations
USER node
EXPOSE 8787
CMD ["node", "dist/main.js"]

FROM node:22.18.0-bookworm-slim AS mcp
ENV NODE_ENV=production
ENV HOST=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /output/mcp ./
USER node
EXPOSE 8788
CMD ["node", "dist/http.js"]

FROM nginxinc/nginx-unprivileged:1.29-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /workspace/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
