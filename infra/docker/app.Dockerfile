FROM node:22-alpine
WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* turbo.json tsconfig.base.json ./
COPY apps ./apps
COPY packages ./packages

RUN pnpm install --frozen-lockfile || pnpm install

ARG VITE_API_URL=http://localhost:3001
ARG VITE_SIGNALING_URL=ws://localhost:3002/ws
ARG VITE_LAN_AGENT_URL=http://localhost:3003
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_SIGNALING_URL=$VITE_SIGNALING_URL
ENV VITE_LAN_AGENT_URL=$VITE_LAN_AGENT_URL

RUN pnpm build
