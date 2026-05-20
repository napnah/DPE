import type { ReactNode } from "react";

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="dpe-modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dpe-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dpe-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dpe-modal__header">
          <h2 id="dpe-modal-title">{title}</h2>
          <button type="button" className="dpe-icon-btn" onClick={onClose} aria-label="关闭">
            ×
          </button>
        </header>
        <div className="dpe-modal__body">{children}</div>
        {footer && <footer className="dpe-modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}
