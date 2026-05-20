import { Link, Outlet, useParams } from "react-router-dom";
import type { DesignVariant } from "./mock-data";
import "./themes/base.css";
import "./themes/github.css";
import "./themes/atlas.css";
import "./themes/breeze.css";

const VARIANT_META: Record<
  DesignVariant,
  { label: string; tagline: string }
> = {
  github: { label: "GitHub 经典", tagline: "白底、顶栏导航、列表与标签页" },
  atlas: { label: "Atlas 工作台", tagline: "侧栏 + 宽内容区，类似 Notion" },
  breeze: { label: "Breeze 精简", tagline: "高密度工具栏，类似 Linear / Vercel" },
};

function isVariant(v: string | undefined): v is DesignVariant {
  return v === "github" || v === "atlas" || v === "breeze";
}

export function DesignLayout() {
  const { variant } = useParams<{ variant: string }>();
  if (!isVariant(variant)) {
    return (
      <main className="dpe-design dpe-github" style={{ padding: "2rem" }}>
        <p>未知设计风格，请从 <Link to="/designs">设计预览入口</Link> 选择。</p>
      </main>
    );
  }

  const meta = VARIANT_META[variant];
  const base = `/designs/${variant}`;

  return (
    <div className={`dpe-design dpe-${variant}`}>
      <header className="dpe-topbar">
        <div className="dpe-topbar__start">
          <Link to="/designs" className="dpe-brand">
            DPE
          </Link>
          <span className="dpe-variant-pill">{meta.label}</span>
          <span className="dpe-preview-tag">设计预览 · 未接后端</span>
        </div>
        <div className="dpe-topbar__end">
          <Link to={`/designs/${variant}/welcome`} className="dpe-btn dpe-btn--ghost">
            身份
          </Link>
          <Link to="/" className="dpe-btn dpe-btn--ghost">
            返回正式版
          </Link>
        </div>
      </header>
      <Outlet context={{ variant, base, meta }} />
    </div>
  );
}

export type DesignOutletContext = {
  variant: DesignVariant;
  base: string;
  meta: { label: string; tagline: string };
};
