FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/lan-agent/package.json apps/lan-agent/
COPY packages ./packages
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm --filter @dpe/lan-agent... build
CMD ["node", "apps/lan-agent/dist/index.js"]
