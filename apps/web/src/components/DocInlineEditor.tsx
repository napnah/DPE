import { useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { openDocKey, parseJwtPayload, importPublicKeyBase64Url } from "@dpe/crypto";
import { SecureYjsProvider, DPE_PROVIDER_ORIGIN } from "@dpe/yjs-provider";
import { canMergeContentWrite } from "@dpe/acl";
import { api } from "../lib/api";
import { loadIdentity, loadPrivateKey } from "../lib/identity";
import { getActiveMesh } from "../lib/mesh-context";

export function DocInlineEditor({
  groupId,
  docId,
}: {
  groupId: string;
  docId: string;
}) {
  const identity = loadIdentity();
  const [status, setStatus] = useState("加载中…");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!identity || !groupId || !docId) return;
    const sk = loadPrivateKey();
    if (!sk) {
      setError("缺少私钥");
      return;
    }

    let cleanup: (() => void) | undefined;
    const doc = new Y.Doc();
    const ytext = doc.getText("content");
    const storageKey = `dpe_doc_${groupId}_${docId}`;

    void (async () => {
      try {
        setError(null);
        const session = await api.refreshJwt(groupId, identity.nodeId, docId);
        const payload = parseJwtPayload(session.jwt);
        const docKey = await openDocKey(sk, payload.doc_key);
        const publicKey = await importPublicKeyBase64Url(identity.publicKeyBase64Url);

        const saved = localStorage.getItem(storageKey);
        if (saved) {
          Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved) as number[]), DPE_PROVIDER_ORIGIN);
        }

        const provider = new SecureYjsProvider({
          doc,
          docId,
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
          canMergeContentWrite(session.role as 0 | 1 | 2 | 3) ? "可编辑 · P2P 已同步" : "只读",
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      }
    })();

    return () => cleanup?.();
  }, [identity, groupId, docId]);

  if (!identity) return null;

  return (
    <div className="app-doc-inline-editor">
      <p className="app-muted app-doc-inline-editor__status">
        {status}
        {savedAt ? ` · 本地已保存 ${savedAt}` : null}
      </p>
      {error && <p className="app-error">{error}</p>}
      <textarea
        ref={editorRef}
        className="app-doc-inline-editor__area"
        placeholder="输入内容（Yjs + 加密同步）…"
      />
    </div>
  );
}
