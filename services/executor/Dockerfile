FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY contracts/package.json contracts/package.json
COPY services/executor/package.json services/executor/package.json
RUN pnpm install --frozen-lockfile --filter @mwe/executor...
COPY contracts contracts
COPY services/executor services/executor
COPY tsconfig.base.json ./
WORKDIR /repo/services/executor
EXPOSE 7460
CMD ["npx", "tsx", "src/main.ts"]
