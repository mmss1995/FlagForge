# syntax=docker/dockerfile:1

# ─── Build: install the workspace, build the dashboard and bundle the server ───
FROM node:22-alpine AS build
WORKDIR /app

# Manifests first, so dependency layers are cached until a package.json changes.
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/js/package.json packages/js/
COPY packages/react/package.json packages/react/
COPY packages/vue/package.json packages/vue/
COPY apps/dashboard/package.json apps/dashboard/
COPY examples/shared/package.json examples/shared/
COPY examples/react-demo/package.json examples/react-demo/
COPY examples/vue-demo/package.json examples/vue-demo/
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

# ─── Runtime: Node plus two static artifacts, no node_modules ───
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    DASHBOARD_DIR=/app/dashboard

COPY --from=build --chown=node:node /app/packages/server/dist ./
COPY --from=build --chown=node:node /app/apps/dashboard/dist ./dashboard

USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:4000/health || exit 1
CMD ["node", "index.js"]
