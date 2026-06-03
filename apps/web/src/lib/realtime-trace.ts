import type { RealtimeDebugSnapshot } from "./realtime-debug.js";

export type TraceCategory = "mesh" | "signal" | "auth" | "yjs" | "editor" | "provider" | "system";
export type TraceLevel = "debug" | "info" | "warn" | "error";

export type RealtimeTraceEvent = {
  id: number;
  t: number;
  /** Milliseconds since trace session start */
  dt: number;
  cat: TraceCategory;
  ev: string;
  level: TraceLevel;
  data?: Record<string, unknown>;
};

export type RealtimeTraceReport = {
  exportedAt: string;
  origin: string;
  userAgent: string;
  traceEnabled: boolean;
  context: Record<string, string>;
  snapshot: RealtimeDebugSnapshot;
  eventCount: number;
  events: RealtimeTraceEvent[];
};

const TRACE_EVENT = "dpe-realtime-trace-update";
const MAX_EVENTS = 500;

let sessionStart = Date.now();
let idSeq = 0;
let events: RealtimeTraceEvent[] = [];
let context: Record<string, string> = {};

function envTraceEnabled(): boolean {
  const flag = import.meta.env.VITE_DPE_P2P_TRACE;
  if (flag === "0" || flag === "false") return false;
  if (flag === "1" || flag === "true") return true;
  return import.meta.env.DEV;
}

let enabled = envTraceEnabled();

function pushEvent(
  cat: TraceCategory,
  ev: string,
  data?: Record<string, unknown>,
  level: TraceLevel = "info",
): RealtimeTraceEvent | null {
  if (!enabled) return null;
  const entry: RealtimeTraceEvent = {
    id: ++idSeq,
    t: Date.now(),
    dt: Date.now() - sessionStart,
    cat,
    ev,
    level,
    ...(data && Object.keys(data).length > 0 ? { data } : {}),
  };
  events.push(entry);
  if (events.length > MAX_EVENTS) events = events.slice(-MAX_EVENTS);

  const payload = data ? ` ${JSON.stringify(data)}` : "";
  const line = `[dpe:${cat}] ${ev}${payload}`;
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);

  window.dispatchEvent(new CustomEvent(TRACE_EVENT, { detail: entry }));
  return entry;
}

export function isRealtimeTraceEnabled(): boolean {
  return enabled;
}

export function setRealtimeTraceEnabled(on: boolean): void {
  enabled = on;
  pushEvent("system", on ? "trace_enabled" : "trace_disabled", undefined, "info");
}

export function setRealtimeTraceContext(patch: Record<string, string | undefined>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete context[k];
    else context[k] = v;
  }
}

export function traceRealtime(
  cat: TraceCategory,
  ev: string,
  data?: Record<string, unknown>,
  level: TraceLevel = "info",
): void {
  pushEvent(cat, ev, data, level);
}

function readDebugSnapshot(): RealtimeDebugSnapshot {
  const fn = (window as Window & { __dpeGetRealtimeSnapshot?: () => RealtimeDebugSnapshot })
    .__dpeGetRealtimeSnapshot;
  if (fn) return fn();
  return {
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
}

export function getRealtimeTraceEvents(): RealtimeTraceEvent[] {
  return [...events];
}

export function clearRealtimeTrace(): void {
  events = [];
  idSeq = 0;
  sessionStart = Date.now();
  pushEvent("system", "trace_cleared", undefined, "info");
}

export function buildRealtimeTraceReport(): RealtimeTraceReport {
  return {
    exportedAt: new Date().toISOString(),
    origin: typeof location !== "undefined" ? location.origin : "",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    traceEnabled: enabled,
    context: { ...context },
    snapshot: readDebugSnapshot(),
    eventCount: events.length,
    events: [...events],
  };
}

export async function copyRealtimeTraceReport(): Promise<RealtimeTraceReport> {
  const report = buildRealtimeTraceReport();
  const text = JSON.stringify(report, null, 2);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
  } else {
    console.log(text);
  }
  return report;
}

export function downloadRealtimeTraceReport(filename?: string): RealtimeTraceReport {
  const report = buildRealtimeTraceReport();
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const gid = context.groupId?.slice(0, 8) ?? "session";
  a.href = url;
  a.download = filename ?? `dpe-p2p-trace-${gid}-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
  return report;
}

export function subscribeRealtimeTrace(listener: (ev: RealtimeTraceEvent) => void): () => void {
  const handler = (e: Event) => {
    const detail = (e as CustomEvent<RealtimeTraceEvent>).detail;
    if (detail) listener(detail);
  };
  window.addEventListener(TRACE_EVENT, handler);
  return () => window.removeEventListener(TRACE_EVENT, handler);
}

declare global {
  interface Window {
    dpeRealtimeTrace?: {
      enabled: () => boolean;
      enable: (on?: boolean) => void;
      trace: typeof traceRealtime;
      getEvents: typeof getRealtimeTraceEvents;
      clear: typeof clearRealtimeTrace;
      export: typeof buildRealtimeTraceReport;
      copy: typeof copyRealtimeTraceReport;
      download: typeof downloadRealtimeTraceReport;
      setContext: typeof setRealtimeTraceContext;
    };
  }
}

if (typeof window !== "undefined") {
  window.dpeRealtimeTrace = {
    enabled: isRealtimeTraceEnabled,
    enable: (on = true) => setRealtimeTraceEnabled(on),
    trace: traceRealtime,
    getEvents: getRealtimeTraceEvents,
    clear: clearRealtimeTrace,
    export: buildRealtimeTraceReport,
    copy: copyRealtimeTraceReport,
    download: downloadRealtimeTraceReport,
    setContext: setRealtimeTraceContext,
  };
}
