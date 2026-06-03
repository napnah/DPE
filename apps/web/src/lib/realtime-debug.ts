export type RealtimeDebugSnapshot = {
  txCount: number;
  txBytes: number;
  rxCount: number;
  rxBytes: number;
  peersInRoom: number;
  channelsOpen: number;
  authedPeers: number;
  lastRejectReason: string | null;
  lastAuthError: string | null;
  updatedAt: number;
};

const EVENT_NAME = "dpe-realtime-debug-update";
const STORE_KEY = "__dpeRealtimeDebugStore";

const EMPTY: RealtimeDebugSnapshot = {
  txCount: 0,
  txBytes: 0,
  rxCount: 0,
  rxBytes: 0,
  peersInRoom: 0,
  channelsOpen: 0,
  authedPeers: 0,
  lastRejectReason: null,
  lastAuthError: null,
  updatedAt: Date.now(),
};

function getStore(): RealtimeDebugSnapshot {
  const w = window as typeof window & {
    [STORE_KEY]?: RealtimeDebugSnapshot;
  };
  if (!w[STORE_KEY]) w[STORE_KEY] = { ...EMPTY };
  return w[STORE_KEY]!;
}

function update(mutator: (state: RealtimeDebugSnapshot) => void): void {
  const state = getStore();
  mutator(state);
  state.updatedAt = Date.now();
  window.dispatchEvent(new CustomEvent(EVENT_NAME, { detail: { ...state } }));
}

export function markRealtimeTx(bytes: number): void {
  update((s) => {
    s.txCount += 1;
    s.txBytes += Math.max(0, bytes);
  });
}

export function markRealtimeRx(bytes: number): void {
  update((s) => {
    s.rxCount += 1;
    s.rxBytes += Math.max(0, bytes);
  });
}

export function markRealtimeReject(reason: string): void {
  update((s) => {
    s.lastRejectReason = reason;
  });
}

export function markRealtimeAuthError(reason: string): void {
  update((s) => {
    s.lastAuthError = reason;
  });
}

export function markRealtimePeerStats(stats: {
  peersInRoom?: number;
  channelsOpen?: number;
  authedPeers?: number;
}): void {
  update((s) => {
    if (typeof stats.peersInRoom === "number") s.peersInRoom = Math.max(0, stats.peersInRoom);
    if (typeof stats.channelsOpen === "number") s.channelsOpen = Math.max(0, stats.channelsOpen);
    if (typeof stats.authedPeers === "number") s.authedPeers = Math.max(0, stats.authedPeers);
  });
}

export function getRealtimeDebugSnapshot(): RealtimeDebugSnapshot {
  return { ...getStore() };
}

export function resetRealtimeDebugSnapshot(): void {
  update((s) => {
    s.txCount = 0;
    s.txBytes = 0;
    s.rxCount = 0;
    s.rxBytes = 0;
    s.peersInRoom = 0;
    s.channelsOpen = 0;
    s.authedPeers = 0;
    s.lastRejectReason = null;
    s.lastAuthError = null;
  });
}

export function subscribeRealtimeDebug(
  listener: (snapshot: RealtimeDebugSnapshot) => void,
): () => void {
  const handler = (ev: Event) => {
    const detail = (ev as CustomEvent<RealtimeDebugSnapshot>).detail;
    listener(detail ?? getRealtimeDebugSnapshot());
  };
  window.addEventListener(EVENT_NAME, handler);
  listener(getRealtimeDebugSnapshot());
  return () => window.removeEventListener(EVENT_NAME, handler);
}

/** Avoid circular import: trace export reads snapshot via window hook. */
if (typeof window !== "undefined") {
  (window as Window & { __dpeGetRealtimeSnapshot?: () => RealtimeDebugSnapshot }).__dpeGetRealtimeSnapshot =
    getRealtimeDebugSnapshot;
}
