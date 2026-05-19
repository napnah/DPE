import { useState } from "react";
import { useNavigate } from "react-router-dom";
export default function OnboardingPage(){
  const nav=useNavigate();
  const [uid,setUid]=useState(()=>localStorage.getItem("dpe_uid"));
  function createIdentity(){const id="dpe_"+crypto.randomUUID().replace(/-/g,"").slice(0,16);localStorage.setItem("dpe_uid",id);setUid(id);}
  return(<main style={{padding:"2rem",maxWidth:560}}><h1>Distributed Privacy Editor</h1><p>生成节点 UID（P1: Ed25519）</p><div className="card">{uid?<p>UID: <code>{uid}</code></p>:<button onClick={createIdentity}>生成身份</button>}</div>{uid&&<button onClick={()=>nav("/dashboard")}>进入总面板</button>}</main>);
}