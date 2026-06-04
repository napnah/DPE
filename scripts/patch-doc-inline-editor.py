# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

(ROOT / "apps/web/src/components/DocInlineEditor.tsx").write_text(
    r'''import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { openDocKey, parseJwtPayload, importPublicKeyBase64Url } from "@dpe/crypto";
import { SecureYjsProvider, DPE_PROVIDER_ORIGIN } from "@dpe/yjs-provider";
import { canMergeContentWrite } from "@dpe/acl";
import { api } from "../lib/api";
import { loadIdentity, loadPrivateKey } from "../lib/identity";
import { getActiveMesh } from "../lib/mesh-context";

type EditorEngine = {
  doc: Y.Doc;
  ytext: Y.Text;
  provider: SecureYjsProvider;
  storageKey: string;
  writable: boolean;
  onDocUpdate: (update: Uint8Array, origin: unknown) => void;
};

export function DocInlineEditor({
  groupId,
  docId,
}: {
  groupId: string;
  docId: string;
}) {
  const identity = loadIdentity();
  const nodeId = identity?.nodeId ?? "";
  const publicKeyBase64Url = identity?.publicKeyBase64Url ?? "";

  const [status, setStatus] = useState("加载中…");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<EditorEngine | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const unbindRef = useRef<(() => void) | null>(null);

  const wireTextarea = useCallback((el: HTMLTextAreaElement) => {
    unbindRef.current?.();
    unbindRef.current = null;

    const eng = engineRef.current;
    if (!eng) return;

    el.value = eng.ytext.toString();
    el.readOnly = !eng.writable;

    const onInput = () => {
      if (el.readOnly) return;
      eng.doc.transact(() => {
        eng.ytext.delete(0, eng.ytext.length);
        eng.ytext.insert(0, el.value);
      });
    };

    const observer = () => {
      if (document.activeElement !== el) {
        el.value = eng.ytext.toString();
      }
    };

    el.addEventListener("input", onInput);
    eng.ytext.observe(observer);

    unbindRef.current = () => {
      el.removeEventListener("input", onInput);
      eng.ytext.unobserve(observer);
    };
  }, []);

  const onTextareaRef = useCallback(
    (el: HTMLTextAreaElement | null) => {
      textareaRef.current = el;
      if (el) wireTextarea(el);
    },
    [wireTextarea],
  );

  useEffect(() => {
    if (!nodeId || !groupId || !docId) return;

    let cancelled = false;
    setStatus("加载中…");
    setError(null);
    setSavedAt(null);
    unbindRef.current?.();
    unbindRef.current = null;
    engineRef.current?.provider.destroy();
    engineRef.current?.doc.destroy();
    engineRef.current = null;

    void (async () => {
      try {
        const sk = loadPrivateKey();
        if (!sk) throw new Error("缺少私钥");

        const session = await api.refreshJwt(groupId, nodeId, docId);
        if (cancelled) return;

        const payload = parseJwtPayload(session.jwt);
        const docKey = await openDocKey(sk, payload.doc_key);
        const publicKey = await importPublicKeyBase64Url(publicKeyBase64Url);
        const writable = canMergeContentWrite(session.role as 0 | 1 | 2 | 3);

        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        const storageKey = `dpe_doc_${groupId}_${docId}`;

        const saved = localStorage.getItem(storageKey);
        if (saved) {
          Y.applyUpdate(doc, Uint8Array.from(JSON.parse(saved) as number[]), DPE_PROVIDER_ORIGIN);
        }

        const provider = new SecureYjsProvider({
          doc,
          docId,
          local: {
            nodeId,
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

        engineRef.current = {
          doc,
          ytext,
          provider,
          storageKey,
          writable,
          onDocUpdate,
        };

        if (textareaRef.current) {
          wireTextarea(textareaRef.current);
        }

        if (cancelled) {
          getActiveMesh()?.detachProvider(provider);
          doc.off("update", onDocUpdate);
          provider.destroy();
          doc.destroy();
          engineRef.current = null;
          return;
        }

        setStatus(
          writable
            ? "可编辑 · 输入将自动保存到本机（P2P 连接后同步协作者）"
            : "只读 · 无写入权限",
        );
      } catch (e) {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : "加载失败";
        setError(
          msg.toLowerCase().includes("failed to fetch")
            ? "无法连接控制平面，请确认 pnpm dev 已启动"
            : msg,
        );
        setStatus("无法加载文档");
      }
    })();

    return () => {
      cancelled = true;
      unbindRef.current?.();
      unbindRef.current = null;
      const eng = engineRef.current;
      if (eng) {
        getActiveMesh()?.detachProvider(eng.provider);
        eng.doc.off("update", eng.onDocUpdate);
        eng.provider.destroy();
        eng.doc.destroy();
        engineRef.current = null;
      }
    };
  }, [nodeId, publicKeyBase64Url, groupId, docId, wireTextarea]);

  if (!identity) return null;

  return (
    <div className="app-doc-inline-editor">
      <p className="app-muted app-doc-inline-editor__status">
        {status}
        {savedAt ? ` · 本机已保存 ${savedAt}` : null}
      </p>
      {error && <p className="app-error">{error}</p>}
      <textarea
        ref={onTextareaRef}
        className="app-doc-inline-editor__area"
        placeholder={error ? "" : "在此输入内容…"}
        readOnly={status.startsWith("加载") || status.startsWith("无法") || status.startsWith("只读")}
      />
    </div>
  );
}
''',
    encoding="utf-8",
)
print("ok DocInlineEditor.tsx")
