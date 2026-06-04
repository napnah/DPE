import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as Y from "yjs";
import {
  openDocKeyForEd25519,
  parseJwtPayload,
  importPublicKeyBase64Url,
} from "@dpe/crypto";
import { SecureYjsProvider, DPE_PROVIDER_ORIGIN } from "@dpe/yjs-provider";
import { canMergeContentWrite } from "@dpe/acl";
import { api } from "../lib/api";
import {
  applyPersistedDocState,
  docStateFromBase64Url,
  docStateToBase64Url,
  loadDocStateFromLocalStorage,
  saveDocStateToLocalStorage,
} from "../lib/doc-persistence";
import { loadPrivateKey } from "../lib/identity";
import { useIdentity } from "../lib/use-identity";
import { getActiveMesh, registerMeshProvider, unregisterMeshProvider } from "../lib/mesh-context";
import { markRealtimeReject } from "../lib/realtime-debug";
import { traceRealtime } from "../lib/realtime-trace";

type EditorMode = "plain" | "markdown" | "blocks" | "table";
type MarkdownView = "edit" | "preview" | "split";

type TableCellValue = string | number | boolean | null;
type TableColumn = {
  id: string;
  name: string;
  type: "text" | "number" | "boolean";
  width?: number;
};
type TableMeta = {
  id: string;
  rowCount: number;
  columnCount: number;
  columns: TableColumn[];
  createdAt?: string;
  updatedAt?: string;
};
type TableData = {
  rows: TableCellValue[][];
};
type TableBlock = {
  id: string;
  type: "table";
  caption?: string;
  columns: TableColumn[];
  rows: TableCellValue[][];
};

type DocBlock =
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "markdown"; source: string }
  | { id: string; type: "image"; assetId: string; alt?: string; caption?: string }
  | { id: string; type: "code"; language?: string; code: string }
  | { id: string; type: "todo"; checked: boolean; text: string }
  | TableBlock;

type ImageAsset = {
  id: string;
  kind: "image";
  name: string;
  mime: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  size: number;
  width?: number;
  height?: number;
  dataUrl: string;
  createdAt: string;
};

type EditorEngine = {
  doc: Y.Doc;
  ytext: Y.Text;
  ymeta: Y.Map<unknown>;
  yblocks: Y.Array<DocBlock>;
  yassets: Y.Map<ImageAsset>;
  ytable: Y.Map<unknown>;
  provider: SecureYjsProvider;
  storageKey: string;
  writable: boolean;
  onDocUpdate: (update: Uint8Array, origin: unknown) => void;
  remoteSaveTimer: ReturnType<typeof setTimeout> | null;
};

const MAX_IMAGE_BYTES = 256 * 1024;
const MAX_GIF_BYTES = 192 * 1024;
const MAX_TOTAL_ASSET_BYTES = 1024 * 1024;
const REMOTE_SNAPSHOT_WARN_BYTES = 1536 * 1024;

function createBlockId(): string {
  return `block_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function createColumnId(): string {
  return `col_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function createDefaultColumns(count: number): TableColumn[] {
  return Array.from({ length: count }, (_, index) => ({
    id: createColumnId(),
    name: String.fromCharCode(65 + index),
    type: "text",
  }));
}

function createDefaultTableBlock(): TableBlock {
  const columns = [
    { id: "col_a", name: "A", type: "text" as const },
    { id: "col_b", name: "B", type: "text" as const },
  ];
  return {
    id: createBlockId(),
    type: "table",
    caption: "",
    columns,
    rows: [
      ["", ""],
      ["", ""],
    ],
  };
}

function getEditorMode(ymeta: Y.Map<unknown> | null): EditorMode {
  const mode = ymeta?.get("editorMode");
  return mode === "markdown" || mode === "blocks" || mode === "table" ? mode : "plain";
}

function setEditorMode(eng: EditorEngine, mode: EditorMode): void {
  if (!eng.writable) return;
  eng.doc.transact(() => {
    eng.ymeta.set("schemaVersion", mode === "table" ? 2 : 1);
    eng.ymeta.set("editorMode", mode);
    eng.ymeta.set("updatedAt", new Date().toISOString());

    if (mode === "blocks" && eng.yblocks.length === 0) {
      const content = eng.ytext.toString();
      eng.yblocks.push([
        content.trim()
          ? { id: createBlockId(), type: "paragraph", text: content }
          : { id: createBlockId(), type: "paragraph", text: "" },
      ]);
    }

    if (mode === "table") {
      ensureTableInitialized(eng.ytable);
    }
  });
}

function applyTextareaDeltaToYText(ytext: Y.Text, nextValue: string): void {
  const prevValue = ytext.toString();
  if (prevValue === nextValue) return;

  let start = 0;
  while (
    start < prevValue.length &&
    start < nextValue.length &&
    prevValue[start] === nextValue[start]
  ) {
    start += 1;
  }

  let prevEnd = prevValue.length;
  let nextEnd = nextValue.length;
  while (
    prevEnd > start &&
    nextEnd > start &&
    prevValue[prevEnd - 1] === nextValue[nextEnd - 1]
  ) {
    prevEnd -= 1;
    nextEnd -= 1;
  }

  const deleteLen = prevEnd - start;
  const insertText = nextValue.slice(start, nextEnd);

  if (deleteLen > 0) ytext.delete(start, deleteLen);
  if (insertText.length > 0) ytext.insert(start, insertText);
}

function isTableColumn(value: unknown): value is TableColumn {
  if (!value || typeof value !== "object") return false;
  const column = value as TableColumn;
  return (
    typeof column.id === "string" &&
    typeof column.name === "string" &&
    (column.type === "text" || column.type === "number" || column.type === "boolean")
  );
}

function normalizeCellForType(value: TableCellValue | undefined, type: TableColumn["type"]): TableCellValue {
  if (value === undefined || value === null) return type === "boolean" ? false : "";
  if (type === "boolean") return value === true || String(value).toLowerCase() === "true";
  if (type === "number") {
    if (value === "") return null;
    const next = typeof value === "number" ? value : Number(value);
    return Number.isFinite(next) ? next : null;
  }
  return String(value);
}

function normalizeTablePayload(metaValue: unknown, dataValue: unknown): { meta: TableMeta; data: TableData } {
  const now = new Date().toISOString();
  const maybeMeta = metaValue && typeof metaValue === "object" ? (metaValue as Partial<TableMeta>) : {};
  const rawColumns = Array.isArray(maybeMeta.columns) ? maybeMeta.columns.filter(isTableColumn) : [];
  const rawRows =
    dataValue && typeof dataValue === "object" && Array.isArray((dataValue as Partial<TableData>).rows)
      ? (dataValue as TableData).rows
      : [];

  const columnCount = Math.max(1, maybeMeta.columnCount ?? rawColumns.length ?? 0, rawRows[0]?.length ?? 0, 3);
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const existing = rawColumns[index];
    return existing ?? { id: createColumnId(), name: String.fromCharCode(65 + index), type: "text" as const };
  });
  const rowCount = Math.max(1, maybeMeta.rowCount ?? rawRows.length ?? 0, 5);
  const rows = Array.from({ length: rowCount }, (_, rowIndex) => {
    const row = Array.isArray(rawRows[rowIndex]) ? rawRows[rowIndex] : [];
    return columns.map((column, columnIndex) => normalizeCellForType(row[columnIndex], column.type));
  });

  return {
    meta: {
      id: typeof maybeMeta.id === "string" ? maybeMeta.id : `table_${Date.now().toString(36)}`,
      rowCount,
      columnCount,
      columns,
      createdAt: typeof maybeMeta.createdAt === "string" ? maybeMeta.createdAt : now,
      updatedAt: typeof maybeMeta.updatedAt === "string" ? maybeMeta.updatedAt : now,
    },
    data: { rows },
  };
}

function ensureTableInitialized(ytable: Y.Map<unknown>): void {
  const current = normalizeTablePayload(ytable.get("meta"), ytable.get("data"));
  ytable.set("meta", current.meta);
  ytable.set("data", current.data);
}

function setYTable(ytable: Y.Map<unknown>, meta: TableMeta, data: TableData): void {
  const nextMeta = {
    ...meta,
    rowCount: data.rows.length,
    columnCount: meta.columns.length,
    updatedAt: new Date().toISOString(),
  };
  ytable.set("meta", nextMeta);
  ytable.set("data", {
    rows: data.rows.map((row) =>
      nextMeta.columns.map((column, columnIndex) => normalizeCellForType(row[columnIndex], column.type)),
    ),
  });
}

function useYTableValue(ytable: Y.Map<unknown> | null): { meta: TableMeta; data: TableData } {
  const [table, setTable] = useState(() => normalizeTablePayload(ytable?.get("meta"), ytable?.get("data")));

  useEffect(() => {
    if (!ytable) {
      setTable(normalizeTablePayload(null, null));
      return;
    }
    const sync = () => setTable(normalizeTablePayload(ytable.get("meta"), ytable.get("data")));
    sync();
    ytable.observe(sync);
    return () => ytable.unobserve(sync);
  }, [ytable]);

  return table;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((csvRow) => csvRow.some((value) => value.length > 0));
}

function inferColumnType(values: string[]): TableColumn["type"] {
  const filled = values.map((value) => value.trim()).filter(Boolean);
  if (filled.length === 0) return "text";
  if (filled.every((value) => value === "true" || value === "false" || value === "是" || value === "否")) {
    return "boolean";
  }
  if (filled.every((value) => Number.isFinite(Number(value)))) return "number";
  return "text";
}

function csvRowsToTable(rows: string[][]): { meta: TableMeta; data: TableData } {
  const header = rows[0] && rows[0].length ? rows[0] : ["A", "B", "C"];
  const body = rows.slice(1);
  const columnCount = Math.max(1, header.length, ...body.map((row) => row.length));
  const columns = Array.from({ length: columnCount }, (_, index) => {
    const values = body.map((row) => row[index] ?? "");
    return {
      id: createColumnId(),
      name: header[index]?.trim() || String.fromCharCode(65 + index),
      type: inferColumnType(values),
    };
  });
  const dataRows = body.length ? body : [Array.from({ length: columnCount }, () => "")];
  return normalizeTablePayload(
    {
      id: `table_${Date.now().toString(36)}`,
      rowCount: dataRows.length,
      columnCount,
      columns,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    { rows: dataRows },
  );
}

function escapeCsvCell(value: TableCellValue): string {
  const text = value === null ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function tableToCsv(columns: TableColumn[], rows: TableCellValue[][]): string {
  return [
    columns.map((column) => escapeCsvCell(column.name)).join(","),
    ...rows.map((row) => columns.map((_, columnIndex) => escapeCsvCell(row[columnIndex] ?? "")).join(",")),
  ].join("\n");
}

function downloadTextFile(filename: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function useYTextValue(ytext: Y.Text | null): string {
  const [value, setValue] = useState(() => ytext?.toString() ?? "");

  useEffect(() => {
    if (!ytext) {
      setValue("");
      return;
    }
    const sync = () => setValue(ytext.toString());
    sync();
    ytext.observe(sync);
    return () => ytext.unobserve(sync);
  }, [ytext]);

  return value;
}

function useYBlocksValue(yblocks: Y.Array<DocBlock> | null): DocBlock[] {
  const [blocks, setBlocks] = useState<DocBlock[]>(() => yblocks?.toArray() ?? []);

  useEffect(() => {
    if (!yblocks) {
      setBlocks([]);
      return;
    }
    const sync = () => setBlocks(yblocks.toArray());
    sync();
    yblocks.observe(sync);
    return () => yblocks.unobserve(sync);
  }, [yblocks]);

  return blocks;
}

function useYAssetsValue(yassets: Y.Map<ImageAsset> | null): Map<string, ImageAsset> {
  const [assets, setAssets] = useState(() => new Map<string, ImageAsset>());

  useEffect(() => {
    if (!yassets) {
      setAssets(new Map());
      return;
    }
    const sync = () => setAssets(new Map(yassets.entries()));
    sync();
    yassets.observe(sync);
    return () => yassets.unobserve(sync);
  }, [yassets]);

  return assets;
}

function replaceBlock(yblocks: Y.Array<DocBlock>, index: number, next: DocBlock): void {
  yblocks.delete(index, 1);
  yblocks.insert(index, [next]);
}

function assetBytesFromDataUrl(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  return Math.ceil((base64.length * 3) / 4);
}

function currentAssetBytes(yassets: Y.Map<ImageAsset>): number {
  let total = 0;
  yassets.forEach((asset) => {
    total += assetBytesFromDataUrl(asset.dataUrl);
  });
  return total;
}

function removeAssetIfUnused(yblocks: Y.Array<DocBlock>, yassets: Y.Map<ImageAsset>, assetId: string): void {
  const stillUsed = yblocks.toArray().some((block) => block.type === "image" && block.assetId === assetId);
  if (!stillUsed) yassets.delete(assetId);
}

async function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

async function readFileAsDataUrl(file: File): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

async function compressImage(file: File): Promise<ImageAsset> {
  const mime = file.type as ImageAsset["mime"];
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(mime)) {
    throw new Error("仅支持 PNG、JPEG、WebP、GIF 图片");
  }

  if (mime === "image/gif") {
    if (file.size > MAX_GIF_BYTES) throw new Error("GIF 图片需小于 192KB");
    const dataUrl = await readFileAsDataUrl(file);
    const dims = await getImageDimensions(dataUrl).catch(() => ({ width: undefined, height: undefined }));
    return {
      id: createBlockId().replace("block_", "asset_"),
      kind: "image",
      name: file.name,
      mime,
      size: file.size,
      ...dims,
      dataUrl,
      createdAt: new Date().toISOString(),
    };
  }

  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法压缩图片");
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const outputMime = mime === "image/png" ? "image/png" : mime;
  let quality = outputMime === "image/png" ? undefined : 0.86;
  let dataUrl = canvas.toDataURL(outputMime, quality);

  while (assetBytesFromDataUrl(dataUrl) > MAX_IMAGE_BYTES && outputMime !== "image/png" && quality && quality > 0.45) {
    quality -= 0.08;
    dataUrl = canvas.toDataURL(outputMime, quality);
  }

  if (assetBytesFromDataUrl(dataUrl) > MAX_IMAGE_BYTES && outputMime === "image/png") {
    quality = 0.82;
    dataUrl = canvas.toDataURL("image/jpeg", quality);
    while (assetBytesFromDataUrl(dataUrl) > MAX_IMAGE_BYTES && quality > 0.45) {
      quality -= 0.08;
      dataUrl = canvas.toDataURL("image/jpeg", quality);
    }
  }

  if (assetBytesFromDataUrl(dataUrl) > MAX_IMAGE_BYTES) {
    throw new Error("图片压缩后仍超过 256KB，请选择更小的图片");
  }

  const finalMime = dataUrl.startsWith("data:image/jpeg") ? "image/jpeg" : outputMime;
  return {
    id: createBlockId().replace("block_", "asset_"),
    kind: "image",
    name: file.name,
    mime: finalMime as ImageAsset["mime"],
    size: assetBytesFromDataUrl(dataUrl),
    width,
    height,
    dataUrl,
    createdAt: new Date().toISOString(),
  };
}

function renderInlineMarkdown(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(!?\[[^\]]+\]\([^)]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text))) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith("![")) {
      const parsed = /^!\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (parsed) nodes.push(<img key={nodes.length} src={parsed[2]} alt={parsed[1]} />);
    } else if (token.startsWith("[")) {
      const parsed = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token);
      if (parsed) {
        nodes.push(
          <a key={nodes.length} href={parsed[2]} target="_blank" rel="noreferrer">
            {parsed[1]}
          </a>,
        );
      }
    } else if (token.startsWith("`")) {
      nodes.push(<code key={nodes.length}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith("**")) {
      nodes.push(<strong key={nodes.length}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("*")) {
      nodes.push(<em key={nodes.length}>{token.slice(1, -1)}</em>);
    }
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function MarkdownPreview({ source, compact = false }: { source: string; compact?: boolean }) {
  const nodes = useMemo(() => renderMarkdownBlocks(source), [source]);
  return (
    <div className={compact ? "app-markdown-preview app-markdown-preview--compact" : "app-markdown-preview"}>
      {nodes.length ? nodes : <p className="app-muted">暂无预览内容</p>}
    </div>
  );
}

function renderMarkdownBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }

    const fence = /^```(\w+)?\s*$/.exec(line);
    if (fence) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i += 1;
      }
      i += i < lines.length ? 1 : 0;
      nodes.push(
        <pre key={nodes.length}>
          <code data-language={fence[1] ?? ""}>{code.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      const content = renderInlineMarkdown(heading[2]);
      const key = nodes.length;
      if (heading[1].length === 1) nodes.push(<h1 key={key}>{content}</h1>);
      if (heading[1].length === 2) nodes.push(<h2 key={key}>{content}</h2>);
      if (heading[1].length === 3) nodes.push(<h3 key={key}>{content}</h3>);
      i += 1;
      continue;
    }

    if (/^\|.+\|\s*$/.test(line) && i + 1 < lines.length && /^\|[\s:-]+\|\s*$/.test(lines[i + 1])) {
      const header = splitTableRow(line);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && /^\|.+\|\s*$/.test(lines[i])) {
        rows.push(splitTableRow(lines[i]));
        i += 1;
      }
      nodes.push(
        <table key={nodes.length}>
          <thead>
            <tr>{header.map((cell, idx) => <th key={idx}>{renderInlineMarkdown(cell)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, rowIdx) => (
              <tr key={rowIdx}>{row.map((cell, idx) => <td key={idx}>{renderInlineMarkdown(cell)}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(line) || /^[-*]\s+\[[ xX]\]\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && (/^[-*]\s+/.test(lines[i]) || /^[-*]\s+\[[ xX]\]\s+/.test(lines[i]))) {
        const task = /^[-*]\s+\[([ xX])\]\s+(.+)$/.exec(lines[i]);
        const text = task ? task[2] : lines[i].replace(/^[-*]\s+/, "");
        items.push(
          <li key={items.length}>
            {task ? <input type="checkbox" checked={task[1].toLowerCase() === "x"} readOnly /> : null}
            {renderInlineMarkdown(text)}
          </li>,
        );
        i += 1;
      }
      nodes.push(<ul key={nodes.length}>{items}</ul>);
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        items.push(<li key={items.length}>{renderInlineMarkdown(lines[i].replace(/^\d+\.\s+/, ""))}</li>);
        i += 1;
      }
      nodes.push(<ol key={nodes.length}>{items}</ol>);
      continue;
    }

    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#{1,3})\s+/.test(lines[i]) && !/^```/.test(lines[i])) {
      paragraph.push(lines[i]);
      i += 1;
    }
    nodes.push(<p key={nodes.length}>{renderInlineMarkdown(paragraph.join(" "))}</p>);
  }

  return nodes;
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

function TableGrid({
  columns,
  rows,
  writable,
  selectedRow,
  selectedColumn,
  onSelectRow,
  onSelectColumn,
  onChange,
}: {
  columns: TableColumn[];
  rows: TableCellValue[][];
  writable: boolean;
  selectedRow?: number | null;
  selectedColumn?: number | null;
  onSelectRow?: (index: number) => void;
  onSelectColumn?: (index: number) => void;
  onChange: (columns: TableColumn[], rows: TableCellValue[][]) => void;
}) {
  const updateCell = (rowIndex: number, columnIndex: number, value: TableCellValue) => {
    const nextRows = rows.map((row, currentRowIndex) =>
      currentRowIndex === rowIndex
        ? columns.map((column, currentColumnIndex) =>
            currentColumnIndex === columnIndex ? normalizeCellForType(value, column.type) : normalizeCellForType(row[currentColumnIndex], column.type),
          )
        : columns.map((column, currentColumnIndex) => normalizeCellForType(row[currentColumnIndex], column.type)),
    );
    onChange(columns, nextRows);
  };

  const updateColumn = (columnIndex: number, patch: Partial<TableColumn>) => {
    const nextColumns = columns.map((column, index) => (index === columnIndex ? { ...column, ...patch } : column));
    const nextRows = rows.map((row) =>
      nextColumns.map((column, index) => normalizeCellForType(row[index], column.type)),
    );
    onChange(nextColumns, nextRows);
  };

  return (
    <div className="app-table-editor__scroller">
      <table className="app-table-editor__grid">
        <thead>
          <tr>
            <th className="app-table-editor__corner" aria-label="行号" />
            {columns.map((column, columnIndex) => (
              <th
                key={column.id}
                className={selectedColumn === columnIndex ? "is-selected" : ""}
                onClick={() => onSelectColumn?.(columnIndex)}
              >
                <input
                  className="app-table-editor__column-name"
                  value={column.name}
                  readOnly={!writable}
                  onChange={(event) => updateColumn(columnIndex, { name: event.target.value })}
                />
                <select
                  className="app-table-editor__column-type"
                  value={column.type}
                  disabled={!writable}
                  onChange={(event) =>
                    updateColumn(columnIndex, { type: event.target.value as TableColumn["type"] })
                  }
                >
                  <option value="text">文本</option>
                  <option value="number">数字</option>
                  <option value="boolean">布尔</option>
                </select>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              <th
                className={selectedRow === rowIndex ? "app-table-editor__row-head is-selected" : "app-table-editor__row-head"}
                onClick={() => onSelectRow?.(rowIndex)}
              >
                {rowIndex + 1}
              </th>
              {columns.map((column, columnIndex) => {
                const value = normalizeCellForType(row[columnIndex], column.type);
                return (
                  <td key={column.id}>
                    {column.type === "boolean" ? (
                      <input
                        type="checkbox"
                        checked={value === true}
                        disabled={!writable}
                        onChange={(event) => updateCell(rowIndex, columnIndex, event.target.checked)}
                      />
                    ) : (
                      <input
                        className="app-table-editor__cell"
                        type={column.type === "number" ? "number" : "text"}
                        value={value === null ? "" : String(value)}
                        readOnly={!writable}
                        onChange={(event) =>
                          updateCell(
                            rowIndex,
                            columnIndex,
                            column.type === "number"
                              ? event.target.value === ""
                                ? null
                                : Number(event.target.value)
                              : event.target.value,
                          )
                        }
                      />
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PlainTextSurface({ eng }: { eng: EditorEngine }) {
  const value = useYTextValue(eng.ytext);

  return (
    <textarea
      className="app-doc-inline-editor__area"
      placeholder="在此输入内容..."
      value={value}
      readOnly={!eng.writable}
      onChange={(event) => {
        if (!eng.writable) return;
        eng.doc.transact(() => applyTextareaDeltaToYText(eng.ytext, event.target.value));
      }}
    />
  );
}

function MarkdownSurface({ eng, view }: { eng: EditorEngine; view: MarkdownView }) {
  const value = useYTextValue(eng.ytext);
  const showEditor = view === "edit" || view === "split";
  const showPreview = view === "preview" || view === "split";

  return (
    <div className={view === "split" ? "app-markdown-surface app-markdown-surface--split" : "app-markdown-surface"}>
      {showEditor && (
        <textarea
          className="app-doc-inline-editor__area app-markdown-surface__editor"
          placeholder="# 标题&#10;&#10;- 列表项&#10;- [ ] 任务项"
          value={value}
          readOnly={!eng.writable}
          onChange={(event) => {
            if (!eng.writable) return;
            eng.doc.transact(() => applyTextareaDeltaToYText(eng.ytext, event.target.value));
          }}
        />
      )}
      {showPreview && <MarkdownPreview source={value} />}
    </div>
  );
}

function TableSurface({ eng, onNotice }: { eng: EditorEngine; onNotice: (msg: string | null) => void }) {
  const { meta, data } = useYTableValue(eng.ytable);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedRow, setSelectedRow] = useState<number | null>(0);
  const [selectedColumn, setSelectedColumn] = useState<number | null>(0);

  useEffect(() => {
    if (selectedRow !== null && selectedRow >= data.rows.length) setSelectedRow(data.rows.length - 1);
    if (selectedColumn !== null && selectedColumn >= meta.columns.length) setSelectedColumn(meta.columns.length - 1);
  }, [data.rows.length, meta.columns.length, selectedColumn, selectedRow]);

  const commit = (columns: TableColumn[], rows: TableCellValue[][]) => {
    if (!eng.writable) return;
    eng.doc.transact(() => setYTable(eng.ytable, { ...meta, columns }, { rows }));
  };

  const addRow = () => {
    commit(meta.columns, [...data.rows, meta.columns.map((column) => normalizeCellForType(undefined, column.type))]);
    setSelectedRow(data.rows.length);
  };

  const addColumn = () => {
    const nextColumn = { id: createColumnId(), name: String.fromCharCode(65 + meta.columns.length), type: "text" as const };
    commit(
      [...meta.columns, nextColumn],
      data.rows.map((row) => [...row, ""]),
    );
    setSelectedColumn(meta.columns.length);
  };

  const deleteSelectedRow = () => {
    if (selectedRow === null || data.rows.length <= 1) return;
    commit(meta.columns, data.rows.filter((_, index) => index !== selectedRow));
    setSelectedRow(Math.max(0, selectedRow - 1));
  };

  const deleteSelectedColumn = () => {
    if (selectedColumn === null || meta.columns.length <= 1) return;
    commit(
      meta.columns.filter((_, index) => index !== selectedColumn),
      data.rows.map((row) => row.filter((_, index) => index !== selectedColumn)),
    );
    setSelectedColumn(Math.max(0, selectedColumn - 1));
  };

  const importCsv = async (file: File | undefined) => {
    if (!file || !eng.writable) return;
    try {
      const parsed = parseCsv(await file.text());
      if (parsed.length === 0) throw new Error("CSV 文件为空");
      const next = csvRowsToTable(parsed);
      eng.doc.transact(() => setYTable(eng.ytable, next.meta, next.data));
      setSelectedRow(0);
      setSelectedColumn(0);
      onNotice(null);
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "导入 CSV 失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="app-table-editor">
      <div className="app-table-editor__actions">
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={addRow}>
          新增行
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={addColumn}>
          新增列
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable || data.rows.length <= 1} onClick={deleteSelectedRow}>
          删除选中行
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable || meta.columns.length <= 1} onClick={deleteSelectedColumn}>
          删除选中列
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => fileInputRef.current?.click()}>
          导入 CSV
        </button>
        <button
          className="app-btn app-btn--small"
          onClick={() => downloadTextFile("dpe-table.csv", tableToCsv(meta.columns, data.rows))}
        >
          导出 CSV
        </button>
        <span className="app-muted">
          {data.rows.length} 行 · {meta.columns.length} 列
        </span>
        <input
          ref={fileInputRef}
          className="app-block-doc__file"
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => void importCsv(event.target.files?.[0])}
        />
      </div>
      <TableGrid
        columns={meta.columns}
        rows={data.rows}
        writable={eng.writable}
        selectedRow={selectedRow}
        selectedColumn={selectedColumn}
        onSelectRow={setSelectedRow}
        onSelectColumn={setSelectedColumn}
        onChange={commit}
      />
    </div>
  );
}

function BlockDocumentSurface({ eng, onNotice }: { eng: EditorEngine; onNotice: (msg: string | null) => void }) {
  const blocks = useYBlocksValue(eng.yblocks);
  const assets = useYAssetsValue(eng.yassets);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const addBlock = (block: DocBlock) => {
    if (!eng.writable) return;
    eng.doc.transact(() => eng.yblocks.push([block]));
  };

  const addImageFile = async (file: File | undefined) => {
    if (!file || !eng.writable) return;
    try {
      onNotice(null);
      const asset = await compressImage(file);
      if (currentAssetBytes(eng.yassets) + asset.size > MAX_TOTAL_ASSET_BYTES) {
        throw new Error("当前文档图片总量已接近 1MB，请先删除部分图片");
      }
      eng.doc.transact(() => {
        eng.yassets.set(asset.id, asset);
        eng.yblocks.push([{ id: createBlockId(), type: "image", assetId: asset.id, alt: "", caption: "" }]);
      });
    } catch (e) {
      onNotice(e instanceof Error ? e.message : "插入图片失败");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  return (
    <div className="app-block-doc">
      <div className="app-block-doc__actions" aria-label="块文档操作">
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => addBlock({ id: createBlockId(), type: "paragraph", text: "" })}>
          段落
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => addBlock({ id: createBlockId(), type: "markdown", source: "" })}>
          Markdown
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => addBlock({ id: createBlockId(), type: "code", language: "ts", code: "" })}>
          代码
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => addBlock({ id: createBlockId(), type: "todo", checked: false, text: "" })}>
          任务
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => addBlock(createDefaultTableBlock())}>
          表格
        </button>
        <button className="app-btn app-btn--small" disabled={!eng.writable} onClick={() => fileInputRef.current?.click()}>
          图片
        </button>
        <input
          ref={fileInputRef}
          className="app-block-doc__file"
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          onChange={(event) => void addImageFile(event.target.files?.[0])}
        />
      </div>

      {blocks.length === 0 ? (
        <p className="app-empty-state">暂无块内容</p>
      ) : (
        <div className="app-block-doc__list">
          {blocks.map((block, index) => (
            <BlockEditor
              key={block.id}
              block={block}
              index={index}
              total={blocks.length}
              asset={block.type === "image" ? assets.get(block.assetId) : undefined}
              writable={eng.writable}
              onChange={(next) => {
                if (!eng.writable) return;
                eng.doc.transact(() => replaceBlock(eng.yblocks, index, next));
              }}
              onMove={(nextIndex) => {
                if (!eng.writable || nextIndex < 0 || nextIndex >= eng.yblocks.length) return;
                eng.doc.transact(() => {
                  const [moving] = eng.yblocks.toArray().slice(index, index + 1);
                  if (!moving) return;
                  eng.yblocks.delete(index, 1);
                  eng.yblocks.insert(nextIndex, [moving]);
                });
              }}
              onDelete={() => {
                if (!eng.writable) return;
                eng.doc.transact(() => {
                  const assetId = block.type === "image" ? block.assetId : null;
                  eng.yblocks.delete(index, 1);
                  if (assetId) removeAssetIfUnused(eng.yblocks, eng.yassets, assetId);
                });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function BlockEditor({
  block,
  index,
  total,
  asset,
  writable,
  onChange,
  onMove,
  onDelete,
}: {
  block: DocBlock;
  index: number;
  total: number;
  asset?: ImageAsset;
  writable: boolean;
  onChange: (block: DocBlock) => void;
  onMove: (nextIndex: number) => void;
  onDelete: () => void;
}) {
  return (
    <section className="app-block">
      <div className="app-block__toolbar">
        <span className="app-block__type">{block.type}</span>
        <div className="app-row-actions">
          <button className="app-btn app-btn--small" disabled={!writable || index === 0} onClick={() => onMove(index - 1)}>
            上移
          </button>
          <button className="app-btn app-btn--small" disabled={!writable || index === total - 1} onClick={() => onMove(index + 1)}>
            下移
          </button>
          <button className="app-btn app-btn--small" disabled={!writable} onClick={onDelete}>
            删除
          </button>
        </div>
      </div>

      {block.type === "paragraph" && (
        <textarea className="app-block__textarea" value={block.text} readOnly={!writable} onChange={(event) => onChange({ ...block, text: event.target.value })} />
      )}

      {block.type === "markdown" && (
        <div className="app-block__grid">
          <textarea className="app-block__textarea" value={block.source} readOnly={!writable} onChange={(event) => onChange({ ...block, source: event.target.value })} />
          <MarkdownPreview source={block.source} compact />
        </div>
      )}

      {block.type === "code" && (
        <>
          <input
            className="app-input app-block__language"
            value={block.language ?? ""}
            readOnly={!writable}
            placeholder="语言"
            onChange={(event) => onChange({ ...block, language: event.target.value })}
          />
          <textarea className="app-block__textarea app-block__textarea--code" value={block.code} readOnly={!writable} onChange={(event) => onChange({ ...block, code: event.target.value })} />
        </>
      )}

      {block.type === "todo" && (
        <label className="app-block__todo">
          <input type="checkbox" checked={block.checked} disabled={!writable} onChange={(event) => onChange({ ...block, checked: event.target.checked })} />
          <input className="app-input" value={block.text} readOnly={!writable} onChange={(event) => onChange({ ...block, text: event.target.value })} />
        </label>
      )}

      {block.type === "image" && (
        <div className="app-block__image">
          {asset ? <img src={asset.dataUrl} alt={block.alt ?? asset.name} /> : <p className="app-error">图片资源缺失</p>}
          <input className="app-input" value={block.alt ?? ""} readOnly={!writable} placeholder="alt 文本" onChange={(event) => onChange({ ...block, alt: event.target.value })} />
          <input className="app-input" value={block.caption ?? ""} readOnly={!writable} placeholder="图片说明" onChange={(event) => onChange({ ...block, caption: event.target.value })} />
          {block.caption ? <p>{block.caption}</p> : null}
        </div>
      )}

      {block.type === "table" && (
        <BlockTableEditor block={block} writable={writable} onChange={(next) => onChange(next)} />
      )}
    </section>
  );
}

function BlockTableEditor({
  block,
  writable,
  onChange,
}: {
  block: TableBlock;
  writable: boolean;
  onChange: (block: TableBlock) => void;
}) {
  const columns = block.columns.length ? block.columns : createDefaultColumns(2);
  const rows = block.rows.length
    ? block.rows.map((row) => columns.map((column, index) => normalizeCellForType(row[index], column.type)))
    : [columns.map((column) => normalizeCellForType(undefined, column.type))];

  const commit = (nextColumns: TableColumn[], nextRows: TableCellValue[][]) => {
    if (!writable) return;
    onChange({
      ...block,
      columns: nextColumns,
      rows: nextRows.map((row) =>
        nextColumns.map((column, index) => normalizeCellForType(row[index], column.type)),
      ),
    });
  };

  return (
    <div className="app-block-table">
      <input
        className="app-input app-block-table__caption"
        value={block.caption ?? ""}
        readOnly={!writable}
        placeholder="表格说明"
        onChange={(event) => onChange({ ...block, caption: event.target.value, columns, rows })}
      />
      <div className="app-block-table__actions">
        <button
          className="app-btn app-btn--small"
          disabled={!writable}
          onClick={() => commit(columns, [...rows, columns.map((column) => normalizeCellForType(undefined, column.type))])}
        >
          新增行
        </button>
        <button
          className="app-btn app-btn--small"
          disabled={!writable}
          onClick={() => {
            const nextColumn = { id: createColumnId(), name: String.fromCharCode(65 + columns.length), type: "text" as const };
            commit(
              [...columns, nextColumn],
              rows.map((row) => [...row, ""]),
            );
          }}
        >
          新增列
        </button>
        <button
          className="app-btn app-btn--small"
          disabled={!writable || rows.length <= 1}
          onClick={() => commit(columns, rows.slice(0, -1))}
        >
          删除末行
        </button>
        <button
          className="app-btn app-btn--small"
          disabled={!writable || columns.length <= 1}
          onClick={() =>
            commit(
              columns.slice(0, -1),
              rows.map((row) => row.slice(0, -1)),
            )
          }
        >
          删除末列
        </button>
      </div>
      <TableGrid columns={columns} rows={rows} writable={writable} onChange={commit} />
    </div>
  );
}

export function DocInlineEditor({
  groupId,
  docId,
}: {
  groupId: string;
  docId: string;
}) {
  const identity = useIdentity();
  const nodeId = identity?.nodeId ?? "";
  const publicKeyBase64Url = identity?.publicKeyBase64Url ?? "";

  const [status, setStatus] = useState("加载中...");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("plain");
  const [markdownView, setMarkdownView] = useState<MarkdownView>("split");
  const [engine, setEngine] = useState<EditorEngine | null>(null);

  const engineRef = useRef<EditorEngine | null>(null);

  const switchMode = useCallback((nextMode: EditorMode) => {
    const eng = engineRef.current;
    if (!eng) return;
    setEditorMode(eng, nextMode);
  }, []);

  useEffect(() => {
    const eng = engine;
    if (!eng) return;
    const syncMode = () => setMode(getEditorMode(eng.ymeta));
    syncMode();
    eng.ymeta.observe(syncMode);
    return () => eng.ymeta.unobserve(syncMode);
  }, [engine]);

  useEffect(() => {
    if (!nodeId || !groupId || !docId) return;

    let cancelled = false;
    setStatus("加载中...");
    setError(null);
    setNotice(null);
    setSavedAt(null);
    setEngine(null);
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
        const docKey = await openDocKeyForEd25519(sk, payload.doc_key);
        const publicKey = await importPublicKeyBase64Url(publicKeyBase64Url);
        const writable = canMergeContentWrite(session.role as 0 | 1 | 2 | 3);

        const doc = new Y.Doc();
        const ytext = doc.getText("content");
        const ymeta = doc.getMap("meta");
        const yblocks = doc.getArray<DocBlock>("blocks");
        const yassets = doc.getMap<ImageAsset>("assets");
        const ytable = doc.getMap("table");
        const storageKey = `dpe_doc_${groupId}_${docId}`;

        let loadedRemoteSnapshot = false;
        try {
          const remote = await api.getDocSnapshot(groupId, docId, nodeId);
          if (!cancelled && remote.snapshot?.state_update_base64) {
            applyPersistedDocState(
              doc,
              docStateFromBase64Url(remote.snapshot.state_update_base64),
              DPE_PROVIDER_ORIGIN,
            );
            loadedRemoteSnapshot = true;
          }
        } catch {
          /* snapshot API optional while offline */
        }
        if (!loadedRemoteSnapshot) {
          const localState = loadDocStateFromLocalStorage(storageKey);
          if (localState) {
            applyPersistedDocState(doc, localState, DPE_PROVIDER_ORIGIN);
          }
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
          onPeerRejected: (_nodeId, reason) => {
            markRealtimeReject(reason);
            traceRealtime("provider", "merge_rejected", { reason, docId }, "warn");
          },
          onError: (err) => {
            markRealtimeReject(
              `provider_error:${err instanceof Error ? err.message : String(err)}`,
            );
          },
        });

        registerMeshProvider(provider);

        const eng: EditorEngine = {
          doc,
          ytext,
          ymeta,
          yblocks,
          yassets,
          ytable,
          provider,
          storageKey,
          writable,
          onDocUpdate: () => undefined,
          remoteSaveTimer: null,
        };

        const persistDoc = () => {
          saveDocStateToLocalStorage(storageKey, doc);
          setSavedAt(new Date().toLocaleTimeString());
          const state = Y.encodeStateAsUpdate(doc);
          if (state.length > REMOTE_SNAPSHOT_WARN_BYTES) {
            setNotice("当前文档包含较大图片，已保存在本机，但远端快照可能失败。");
          }
          if (!writable) return;
          if (eng.remoteSaveTimer) clearTimeout(eng.remoteSaveTimer);
          eng.remoteSaveTimer = setTimeout(() => {
            void api
              .putDocSnapshot(groupId, docId, {
                node_id: nodeId,
                state_update_base64: docStateToBase64Url(state),
              })
              .catch(() => {
                /* keep local draft if server unavailable */
              });
          }, 800);
        };

        const onDocUpdate = (_update: Uint8Array, origin: unknown) => {
          if (origin === DPE_PROVIDER_ORIGIN) {
            traceRealtime("yjs", "doc_update_remote", { docId, len: ytext.length }, "debug");
          }
          persistDoc();
        };
        eng.onDocUpdate = onDocUpdate;
        doc.on("update", onDocUpdate);

        engineRef.current = eng;

        if (cancelled) {
          if (eng.remoteSaveTimer) clearTimeout(eng.remoteSaveTimer);
          saveDocStateToLocalStorage(storageKey, doc);
          unregisterMeshProvider(provider);
          doc.off("update", onDocUpdate);
          provider.destroy();
          doc.destroy();
          engineRef.current = null;
          return;
        }

        setEngine(eng);
        setMode(getEditorMode(ymeta));
        setStatus(
          writable
            ? "可编辑 · 输入将自动保存到数据库（P2P 连接后同步协作者）"
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
      const eng = engineRef.current;
      if (eng) {
        if (eng.remoteSaveTimer) clearTimeout(eng.remoteSaveTimer);
        saveDocStateToLocalStorage(eng.storageKey, eng.doc);
        unregisterMeshProvider(eng.provider);
        eng.doc.off("update", eng.onDocUpdate);
        eng.provider.destroy();
        eng.doc.destroy();
        engineRef.current = null;
      }
    };
  }, [nodeId, publicKeyBase64Url, groupId, docId]);

  const readonly = !engine?.writable;
  const loading = !engine || status.startsWith("加载") || status.startsWith("无法");

  if (!identity) return null;

  return (
    <div className="app-doc-inline-editor">
      <div className="app-doc-inline-editor__toolbar">
        <div className="app-segmented" aria-label="编辑模式">
          {(["plain", "markdown", "blocks", "table"] as const).map((item) => (
            <button
              key={item}
              className={mode === item ? "is-active" : ""}
              disabled={loading || readonly}
              onClick={() => switchMode(item)}
            >
              {item === "plain" ? "纯文本" : item === "markdown" ? "Markdown" : item === "blocks" ? "块文档" : "表格"}
            </button>
          ))}
        </div>

        {mode === "markdown" && (
          <div className="app-segmented" aria-label="Markdown 视图">
            {(["edit", "preview", "split"] as const).map((item) => (
              <button key={item} className={markdownView === item ? "is-active" : ""} onClick={() => setMarkdownView(item)}>
                {item === "edit" ? "编辑" : item === "preview" ? "预览" : "分栏"}
              </button>
            ))}
          </div>
        )}
      </div>

      <p className="app-muted app-doc-inline-editor__status">
        {status}
        {savedAt ? ` · 已保存 ${savedAt}` : null}
      </p>
      {error && <p className="app-error">{error}</p>}
      {notice && <p className="app-doc-inline-editor__notice">{notice}</p>}

      {!engine ? (
        <textarea className="app-doc-inline-editor__area" placeholder={error ? "" : "在此输入内容..."} readOnly />
      ) : mode === "plain" ? (
        <PlainTextSurface eng={engine} />
      ) : mode === "markdown" ? (
        <MarkdownSurface eng={engine} view={markdownView} />
      ) : mode === "table" ? (
        <TableSurface eng={engine} onNotice={setNotice} />
      ) : (
        <BlockDocumentSurface eng={engine} onNotice={setNotice} />
      )}
    </div>
  );
}
