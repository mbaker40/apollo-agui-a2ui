# Builds the custom A2UI composer + catalog as ONE static site (composer at
# /, catalog under /catalog/ — the same layout as the GitHub Pages deploy)
# and serves it with Caddy. Used by the Railway deployment: the service sets
# RAILWAY_DOCKERFILE_PATH=deploy/composer.Dockerfile and builds with the repo
# root as context, like the compose Dockerfiles. No secrets are baked in —
# visitors bring their own Anthropic key in-browser.
FROM node:22-alpine AS build
RUN corepack enable
WORKDIR /app
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY apps/composer/package.json apps/composer/package.json
COPY apps/catalog/package.json apps/catalog/package.json
COPY packages/a2ui-bridge/package.json packages/a2ui-bridge/package.json
RUN pnpm install --frozen-lockfile --filter @mwe/composer... --filter @mwe/composer-catalog...
COPY packages/a2ui-bridge packages/a2ui-bridge
COPY apps/composer apps/composer
COPY apps/catalog apps/catalog
COPY tsconfig.base.json ./
RUN COMPOSER_BASE=/ pnpm --filter @mwe/composer build \
  && COMPOSER_BASE=/catalog/ pnpm --filter @mwe/composer-catalog build \
  && mkdir -p /site/catalog \
  && cp -R apps/composer/dist/. /site/ \
  && cp -R apps/catalog/dist/. /site/catalog/ \
  # The renderer's relative GET_CATALOG fetch resolves to exactly this file.
  && test -f /site/catalog/catalog

FROM caddy:2-alpine
COPY --from=build /site /srv
# Railway injects PORT; default kept for local runs.
CMD ["sh", "-c", "exec caddy file-server --root /srv --listen :${PORT:-8080}"]
