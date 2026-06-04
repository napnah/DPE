import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import {
  applyPersistedDocState,
  encodeDocState,
  docStateFromBase64Url,
  docStateToBase64Url,
} from "./doc-persistence.js";

const ORIGIN = Symbol("test-origin");

describe("doc-persistence", () => {
  it("round-trips full Yjs state (not a single incremental delta)", () => {
    const doc = new Y.Doc();
    doc.getText("content").insert(0, "hello persistence");
    const full = encodeDocState(doc);

    const restored = new Y.Doc();
    applyPersistedDocState(restored, full, ORIGIN);
    expect(restored.getText("content").toString()).toBe("hello persistence");

    const viaB64 = docStateFromBase64Url(docStateToBase64Url(full));
    const merged = new Y.Doc();
    applyPersistedDocState(merged, viaB64, ORIGIN);
    expect(merged.getText("content").toString()).toBe("hello persistence");
  });

  it("round-trips editor meta, blocks, and image assets", () => {
    const doc = new Y.Doc();
    doc.getMap("meta").set("editorMode", "blocks");
    doc.getArray("blocks").push([
      { id: "p1", type: "paragraph", text: "hello blocks" },
      { id: "img1", type: "image", assetId: "asset1", caption: "demo" },
    ]);
    doc.getMap("assets").set("asset1", {
      id: "asset1",
      kind: "image",
      name: "demo.png",
      mime: "image/png",
      size: 68,
      width: 1,
      height: 1,
      dataUrl:
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      createdAt: "2026-06-04T00:00:00.000Z",
    });

    const restored = new Y.Doc();
    applyPersistedDocState(restored, encodeDocState(doc), ORIGIN);

    expect(restored.getMap("meta").get("editorMode")).toBe("blocks");
    expect(restored.getArray("blocks").toArray()).toEqual([
      { id: "p1", type: "paragraph", text: "hello blocks" },
      { id: "img1", type: "image", assetId: "asset1", caption: "demo" },
    ]);
    expect(restored.getMap("assets").get("asset1")).toMatchObject({
      kind: "image",
      name: "demo.png",
      mime: "image/png",
    });
  });
});
