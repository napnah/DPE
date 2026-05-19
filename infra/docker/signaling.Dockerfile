FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml ./
COPY apps/signaling ./apps/signaling
RUN cd apps/signaling && npm install && npm run build
CMD ["node", "apps/signaling/dist/index.js"]
