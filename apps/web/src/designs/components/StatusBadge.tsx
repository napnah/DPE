export type StatusTone = "ok" | "warn" | "err" | "neutral";

export function StatusBadge({
  label,
  tone = "neutral",
}: {
  label: string;
  tone?: StatusTone;
}) {
  return <span className={`dpe-badge dpe-badge--${tone}`}>{label}</span>;
}
