FROM node:22-alpine
WORKDIR /repo
RUN corepack enable
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json .npmrc* ./
COPY contracts/package.json contracts/package.json
COPY services/executor/package.json services/executor/package.json
COPY services/graphql/package.json services/graphql/package.json
RUN pnpm install --frozen-lockfile --filter @mwe/graphql...
COPY contracts contracts
COPY services/graphql services/graphql
COPY tsconfig.base.json ./
WORKDIR /repo/services/graphql
EXPOSE 7461
CMD ["npx", "tsx", "src/main.ts"]
