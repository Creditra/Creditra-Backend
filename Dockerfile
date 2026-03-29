# ── Stage 1: base ────────────────────────────────────────────────────────────
# Shared foundation: install only package manifests so Docker can cache the
# npm install layer independently of source-code changes.
FROM node:20-alpine AS base
WORKDIR /app
COPY package*.json ./

# ── Stage 2: development ─────────────────────────────────────────────────────
# Full devDependencies + live-reload via tsx watch.
# docker compose up will use this target.
FROM base AS development
# Install ALL dependencies (including devDependencies for tsx / type-check)
RUN npm install
COPY . .
# Switch to the built-in non-root user that the node image provides
RUN chown -R node:node /app
USER node
# tsx watch re-compiles on every source change mounted via the bind volume
CMD ["npm", "run", "dev"]

# ── Stage 3: build ───────────────────────────────────────────────────────────
# Compiles TypeScript → dist/ with production deps only.
FROM base AS build
RUN npm ci
COPY . .
RUN npm run build

# ── Stage 4: runner (production) ─────────────────────────────────────────────
# Minimal image: only compiled output + production node_modules.
FROM node:20-alpine AS runner
WORKDIR /app
# Copy compiled JS and production deps from the build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./
# Copy the OpenAPI spec that src/index.ts reads at runtime (relative to dist/)
COPY --from=build /app/src/openapi.yaml ./dist/openapi.yaml
# Non-root user for security (CIS Docker Benchmark)
RUN chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]