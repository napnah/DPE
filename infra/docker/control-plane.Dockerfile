FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/control-plane/package.json apps/control-plane/
COPY packages ./packages
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm --filter @dpe/control-plane... build
CMD ["node", "apps/control-plane/dist/main.js"]
