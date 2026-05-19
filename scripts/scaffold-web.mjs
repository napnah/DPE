import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function w(r,c){const p=path.join(root,r);fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,c,"utf8");}

w("apps/web/package.json", JSON.stringify({
  name:"@dpe/web",version:"0.1.0",private:true,type:"module",
  scripts:{dev:"vite",build:"tsc --noEmit && vite build",preview:"vite preview",lint:"tsc --noEmit"},
  dependencies:{"@dpe/shared":"workspace:*",react:"^19.0.0","react-dom":"^19.0.0","react-router-dom":"^7.1.1"},
  devDependencies:{"@types/react":"^19.0.0","@types/react-dom":"^19.0.0","@vitejs/plugin-react":"^4.3.4",typescript:"^5.7.2",vite:"^6.0.6"}
},null,2)+"\n");

w("apps/web/tsconfig.json", JSON.stringify({compilerOptions:{target:"ES2022",lib:["ES2022","DOM","DOM.Iterable"],module:"ESNext",moduleResolution:"bundler",jsx:"react-jsx",strict:true,skipLibCheck:true,noEmit:true},include:["src"]},null,2)+"\n");
w("apps/web/vite.config.ts", 'import { defineConfig } from "vite";\nimport react from "@vitejs/plugin-react";\nexport default defineConfig({ plugins: [react()], server: { port: 5173, host: true } });\n');
w("apps/web/src/main.tsx", `import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import "./index.css";
createRoot(document.getElementById("root")!).render(<StrictMode><BrowserRouter><App /></BrowserRouter></StrictMode>);`);
w("apps/web/src/App.tsx", `import { Link, Route, Routes } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import OnboardingPage from "./pages/OnboardingPage";
import GroupPage from "./pages/GroupPage";
export default function App() {
  return (<Routes>
    <Route path="/" element={<OnboardingPage />} />
    <Route path="/dashboard" element={<DashboardPage />} />
    <Route path="/groups/:groupId" element={<GroupPage />} />
    <Route path="*" element={<div><Link to="/">Home</Link></motion.div>} />
  </Routes>);
}`.replace("<motion.div>","<div>").replace("</motion.div>","</motion.div>").replace("</motion.div>","</motion.div>").replace("</motion.div>","</div>"));
w("apps/web/src/index.css", ":root{font-family:system-ui,sans-serif}body{margin:0;background:#0f1419;color:#e7ecf3}a{color:#6cb6ff}.card{background:#1a2332;border-radius:8px;padding:1rem;margin:.5rem 0}button{cursor:pointer}\n");
w("apps/web/src/pages/OnboardingPage.tsx", `import { useState } from "react";
import { useNavigate } from "react-router-dom";
export default function OnboardingPage(){
  const nav=useNavigate();
  const [uid,setUid]=useState(()=>localStorage.getItem("dpe_uid"));
  function createIdentity(){const id="dpe_"+crypto.randomUUID().replace(/-/g,"").slice(0,16);localStorage.setItem("dpe_uid",id);setUid(id);}
  return(<main style={{padding:"2rem",maxWidth:560}}><h1>Distributed Privacy Editor</h1><p>生成节点 UID（P1: Ed25519）</p><div className="card">{uid?<p>UID: <code>{uid}</code></p>:<button onClick={createIdentity}>生成身份</button>}</div>{uid&&<button onClick={()=>nav("/dashboard")}>进入总面板</button>}</main>);
}`);
console.log("web ok");