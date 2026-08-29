# Build the static bundle, then serve it with vite preview (kept as one image
# for MWE simplicity; a real deployment would use a static file server/CDN).
FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY contracts/package.json contracts/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @mwe/web...
COPY contracts contracts
COPY apps/web apps/web
COPY tsconfig.base.json ./
WORKDIR /repo/apps/web
RUN pnpm build
EXPOSE 7463
CMD ["pnpm", "preview"]
