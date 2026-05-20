import { useState, type ReactNode } from "react";

export function TechDetails({
  title = "技术详情",
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="dpe-tech-details">
      <button type="button" className="dpe-tech-details__toggle" onClick={() => setOpen((v) => !v)}>
        {open ? "收起" : "展开"} {title}
      </button>
      {open && <div className="dpe-tech-details__body">{children}</div>}
    </div>
  );
}

export function TechRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="dpe-tech-row">
      <span className="dpe-tech-row__label">{label}</span>
      <code className="dpe-tech-row__value">{value}</code>
    </div>
  );
}
