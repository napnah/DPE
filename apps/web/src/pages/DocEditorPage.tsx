import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as Y from "yjs";
import { openDocKey, verifyJwt, importPublicKeyBase64Url } from "@dpe/crypto";
import { SecureYjsProvider, DPE_PROVIDER_ORIGIN } from "@dpe/yjs-provider";
import { canMergeContentWrite } from "@dpe/acl";
import { api, loadGroupAdminKey } from "../lib/api";
import { loadIdentity, loadPrivateKey } from "../lib/identity";
import { getActiveMesh } from "../lib/mesh-context";

export default function DocEditorPage() {
  const { groupId, docId } = useParams<{ groupId: string; docId: string }>();
  const identity = loadIdentity();
  const gid = groupId ?? "";
  const did = docId ?? "root";

  const [role, setRole] = useState<number | null>(null);
  const [status, setStatus] = useState("加载中…");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!identity || !gid) return;
    const sk = loadPrivateKey();
    const pkAdmin = loadGroupAdminKey(gid);
    if (!sk || !pkAdmin) {
      setError("缺少密钥或群组 Admin 公钥（请从群组页进入）");
      return;
    }

    let cleanup: (() => void) | undefined;
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    const storageKey = `dpe_doc_${gid}_${did}`;

    void (async () => {
      try {
        const session = await api.refreshJwt(gid, identity.nodeId, did);
        setRole(session.role);
        const adminPk = await importPublicKeyBase64Url(pkAdmin);
        const payload = await verifyJwt(session.jwt, adminPk, { audience: gid });
        const docKey = await openDocKey(sk, payload.doc_key);
        const publicKey = await importPublicKeyBase64Url(identity.publicKeyBase64Url);

        const saved = localStorage.getItem(storageKey);
        if (saved) {
          Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved) as number[]), DPE_PROVIDER_ORIGIN);
        }

        const provider = new SecureYjsProvider({
          doc,
          docId: did,
          local: {
            nodeId: identity.nodeId,
            role: session.role as 0 | 1 | 2 | 3,
            privateKey: sk,
            publicKey,
            docKey,
            keyVersion: session.key_version,
          },
          send: (frame) => getActiveMesh()?.broadcast(frame),
        });

        getActiveMesh()?.attachProvider(provider);

        const onDocUpdate = (update: Uint8Array, origin: unknown) => {
          if (origin === DPE_PROVIDER_ORIGIN) return;
          localStorage.setItem(storageKey, JSON.stringify([...update]));
          setSavedAt(new Date().toLocaleTimeString());
        };
        doc.on("update", onDocUpdate);

        const el = editorRef.current;
        if (el) {
          el.value = ytext.toString();
          el.readOnly = !canMergeContentWrite(session.role as 0 | 1 | 2 | 3);
          const onInput = () => {
            if (el.readOnly) return;
            doc.transact(() => {
              ytext.delete(0, ytext.length);
              ytext.insert(0, el.value);
            });
          };
          const observer = () => {
            if (document.activeElement !== el) el.value = ytext.toString();
          };
          el.addEventListener("input", onInput);
          ytext.observe(observer);
          cleanup = () => {
            el.removeEventListener("input", onInput);
            ytext.unobserve(observer);
            doc.off("update", onDocUpdate);
            getActiveMesh()?.detachProvider(provider);
            provider.destroy();
            doc.destroy();
          };
        }

        setStatus(
          canMergeContentWrite(session.role as 0 | 1 | 2 | 3) ? "可编辑 · P2P 已连接" : "只读",
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    })();

    return () => cleanup?.();
  }, [identity, gid, did]);

  if (!identity) {
    return (
      <main style={{ padding: "2rem" }}>
        <p>
          请先 <Link to="/">生成身份</Link>
        </p>
      </main>
    );
  }

  return (
    <main style={{ padding: "2rem", maxWidth: 900 }}>
      <p>
        <Link to={`/groups/${gid}`}>← 群组</Link>
      </p>
      <h1>文档: {did}</h1>
      <p>
        {status}
        {savedAt ? ` · 本地已保存 ${savedAt}` : null}
      </p>
      {error && <p style={{ color: "#f88" }}>{error}</p>}
      <textarea
        ref={editorRef}
        rows={18}
        style={{
          width: "100%",
          fontFamily: "inherit",
          fontSize: 15,
          padding: "1rem",
          background: "#1a2332",
          color: "#e7ecf3",
          border: "1px solid #2d3a4d",
          borderRadius: 8,
        }}
        placeholder={role === 1 ? "只读模式" : "输入内容（Yjs + 加密同步）…"}
      />
    </main>
  );
}
