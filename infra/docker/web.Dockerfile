FROM node:22-alpine
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY apps/web/package.json apps/web/
COPY packages ./packages
RUN pnpm install --frozen-lockfile || pnpm install
COPY . .
ARG VITE_API_URL=http://localhost:3001
ARG VITE_SIGNALING_URL=ws://localhost:3002/ws
ARG VITE_LAN_AGENT_URL=http://localhost:3003
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SIGNALING_URL=$VITE_SIGNALING_URL
ENV VITE_LAN_AGENT_URL=$VITE_LAN_AGENT_URL
RUN pnpm --filter @dpe/web... build
CMD ["pnpm", "--filter", "@dpe/web", "preview", "--host", "0.0.0.0", "--port", "5173"]
