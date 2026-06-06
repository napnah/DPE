import { useCallback, useEffect, useState } from "react";
import {
  clearRealtimeTrace,
  copyRealtimeTraceReport,
  downloadRealtimeTraceReport,
  getRealtimeTraceEvents,
  isRealtimeTraceEnabled,
  isRealtimeTraceUiEnabled,
  setRealtimeTraceEnabled,
  subscribeRealtimeTrace,
  type RealtimeTraceEvent,
} from "../lib/realtime-trace";

function formatEventLine(ev: RealtimeTraceEvent): string {
  const data = ev.data ? ` ${JSON.stringify(ev.data)}` : "";
  return `+${(ev.dt / 1000).toFixed(2)}s [${ev.cat}] ${ev.ev}${data}`;
}

export function RealtimeTracePanel() {
  const uiEnabled = isRealtimeTraceUiEnabled();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(isRealtimeTraceEnabled);
  const [events, setEvents] = useState<RealtimeTraceEvent[]>(() => getRealtimeTraceEvents());
  const [toast, setToast] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    if (!uiEnabled) return;
    return subscribeRealtimeTrace(() => {
      setEvents(getRealtimeTraceEvents());
    });
  }, [uiEnabled]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2500);
  }, []);

  const filtered = filter.trim()
    ? events.filter((e) => formatEventLine(e).toLowerCase().includes(filter.trim().toLowerCase()))
    : events;

  const recent = filtered.slice(-80);

  async function onCopy() {
    try {
      const report = await copyRealtimeTraceReport();
      showToast(`已复制 ${report.eventCount} 条事件（含 snapshot）`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "复制失败");
    }
  }

  function onDownload() {
    const report = downloadRealtimeTraceReport();
    showToast(`已下载 ${report.eventCount} 条事件`);
  }

  function onClear() {
    clearRealtimeTrace();
    setEvents([]);
    showToast("日志已清空");
  }

  function toggleEnabled() {
    const next = !enabled;
    setRealtimeTraceEnabled(next);
    setEnabled(next);
    showToast(next ? "追踪已开启" : "追踪已关闭");
  }

  if (!uiEnabled) return null;

  return (
    <section className="app-panel app-realtime-trace">
      <div className="app-realtime-trace__head">
        <button
          type="button"
          className="app-realtime-trace__toggle"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "▼" : "▶"} P2P 诊断日志
          <span className="app-muted"> · {events.length} 条</span>
          {!enabled && <span className="app-muted">（已暂停）</span>}
        </button>
        <div className="app-realtime-trace__actions">
          <button type="button" className="app-btn app-btn--small" onClick={() => void onCopy()}>
            复制报告
          </button>
          <button type="button" className="app-btn app-btn--small" onClick={onDownload}>
            下载 JSON
          </button>
          <button type="button" className="app-btn app-btn--small" onClick={onClear}>
            清空
          </button>
          <button type="button" className="app-btn app-btn--small" onClick={toggleEnabled}>
            {enabled ? "暂停" : "开启"}
          </button>
        </div>
      </div>

      {open && (
        <>
          <p className="app-muted app-realtime-trace__hint">
            双机复现不同步后点「复制报告」，把 JSON 发给协作者分析。控制台可用{" "}
            <code>window.dpeRealtimeTrace.copy()</code>。生产构建请设{" "}
            <code>VITE_DPE_P2P_TRACE=1</code>。
          </p>
          <input
            className="app-input app-realtime-trace__filter"
            placeholder="过滤关键字（peer、auth、yjs…）"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <pre className="app-realtime-trace__log" aria-live="polite">
            {recent.length === 0 ? (
              <span className="app-muted">暂无事件。请编辑文档或等待 P2P 连接。</span>
            ) : (
              recent.map((ev) => (
                <div
                  key={ev.id}
                  className={`app-realtime-trace__line app-realtime-trace__line--${ev.level}`}
                >
                  {formatEventLine(ev)}
                </div>
              ))
            )}
          </pre>
          <p className="app-muted app-realtime-trace__foot">
            显示最近 {recent.length} / {events.length} 条 · snapshot 见导出 JSON
          </p>
        </>
      )}

      {toast && <p className="app-toast">{toast}</p>}
    </section>
  );
}
