FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/signaling/package.json apps/signaling/
COPY packages ./packages
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
RUN pnpm --filter @dpe/signaling... build
CMD ["node", "apps/signaling/dist/index.js"]
