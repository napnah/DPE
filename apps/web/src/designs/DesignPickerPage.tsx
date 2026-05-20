import { Link } from "react-router-dom";

const VARIANTS = [
  {
    id: "github",
    name: "GitHub 经典",
    desc: "白底灰边、顶栏 Tab、列表行悬停。适合熟悉 GitHub / GitLab 的开发者。",
    swatch: ["#ffffff", "#f6f8fa", "#0969da", "#1f2328"],
  },
  {
    id: "atlas",
    name: "Atlas 工作台",
    desc: "左侧宽导航 + 柔和卡片阴影，信息分区清晰，类似 Notion / 飞书文档。",
    swatch: ["#fbfbfa", "#f1f0ed", "#2eaadc", "#37352f"],
  },
  {
    id: "breeze",
    name: "Breeze 精简",
    desc: "高对比、紧凑字号、细边框工具栏，类似 Linear / Vercel Dashboard。",
    swatch: ["#fafafa", "#ededed", "#000000", "#666666"],
  },
] as const;

export default function DesignPickerPage() {
  return (
    <main className="dpe-picker">
      <header className="dpe-picker__hero">
        <p className="dpe-eyebrow">DPE · 前端设计预览</p>
        <h1>三种明亮界面风格</h1>
        <p>
          仅展示 UI，未连接 control-plane / P2P。覆盖需求与后端接口的全部功能入口；Node ID、公钥等仅在「技术详情」中展开。
        </p>
        <Link to="/" className="dpe-picker__link">
          返回当前功能版应用 →
        </Link>
      </header>
      <div className="dpe-picker__grid">
        {VARIANTS.map((v) => (
          <article key={v.id} className="dpe-picker__card">
            <div className="dpe-picker__swatches">
              {v.swatch.map((c) => (
                <span key={c} style={{ background: c }} title={c} />
              ))}
            </div>
            <h2>{v.name}</h2>
            <p>{v.desc}</p>
            <ul className="dpe-picker__features">
              <li>身份 / 总览卡片 / 连接页 / 群组 / 编辑器（左侧文档树）</li>
              <li>邀请 · 邻居 · ACL · 密钥轮换</li>
              <li>代理治理 · 加入群组 · DeleteDoc</li>
            </ul>
            <Link to={`/designs/${v.id}/welcome`} className="dpe-picker__cta">
              预览此风格
            </Link>
          </article>
        ))}
      </div>
      <section className="dpe-picker__coverage">
        <h2>功能覆盖对照</h2>
        <table>
          <thead>
            <tr>
              <th>能力</th>
              <th>后端 / 文档</th>
              <th>预览入口</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["生成本机身份", "Onboarding / Ed25519", "欢迎页"],
              ["建群、列表", "POST /groups, GET groups/all", "总览 · 群组卡片"],
              ["邀请 / 接受 / 拒绝", "invitations API", "连接与邀请"],
              ["加入群组", "POST /groups/:id/join", "连接与邀请"],
              ["LAN 网络 / 邻居", "lan-agent", "连接与邀请"],
              ["群组 RBAC 治理", "governance", "群组设置"],
              ["文档树 / 新建", "tree, CreateChild", "群组 · 文档侧栏"],
              ["成员列表", "GET /members", "群组 · 成员"],
              ["SetDocRoleAcl", "RPC", "群组 · 权限"],
              ["JWT 刷新", "jwt/refresh", "群组 · 连接"],
              ["rotate-key", "rotate-key", "群组 · 设置"],
              ["DeleteDoc", "RPC", "群组 · 设置"],
              ["enable/disable proxy", "governance", "群组 · 设置"],
              ["Yjs 编辑 / 只读", "P5 编辑器", "文档页"],
              ["P2P 重试信令", "P3 mesh", "群组顶栏"],
            ].map(([a, b, c]) => (
              <tr key={a}>
                <td>{a}</td>
                <td>
                  <code>{b}</code>
                </td>
                <td>{c}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </main>
  );
}
