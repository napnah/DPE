#!/usr/bin/env bash
set -u
export PATH="/home/nap/.nvm/versions/node/v20.20.2/bin:/home/nap/.local/share/pnpm/bin:$PATH"
cd ~/DPE || exit 1

echo "[restart] killing stale dev processes"
fuser -k 3001/tcp 3002/tcp 3003/tcp 5173/tcp 2>/dev/null || true
pkill -f "turbo run dev" 2>/dev/null || true
pkill -f "tsc --watch" 2>/dev/null || true
pkill -f "vite" 2>/dev/null || true
sleep 3

echo "[restart] starting pnpm dev"
nohup pnpm dev > /tmp/dpe-dev.log 2>&1 &
DEV_PID=$!
echo "$DEV_PID" > /tmp/dpe-dev.pid
echo "[restart] started pid=$DEV_PID"

echo "[restart] waiting for health"
for i in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3001/health >/dev/null 2>&1 \
     && curl -fsS http://127.0.0.1:3002/health >/dev/null 2>&1 \
     && curl -fsS http://127.0.0.1:3003/health >/dev/null 2>&1; then
    echo "[restart] READY after ${i}s"
    exit 0
  fi
  sleep 1
done
echo "[restart] NOT-READY, tail log:"
tail -n 60 /tmp/dpe-dev.log
exit 1
