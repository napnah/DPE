#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTENT = r'''import { useCallback, useEffect, useMemo, useState } from "react";
import { ROOT_DOC_ID, isFolderDoc } from "@dpe/shared";

export type DocTreeNode = {
  docId: string;
  parentDocId: string | null;
  title: string;
  isFolder?: boolean;
};

function childrenOf(nodes: DocTreeNode[], parentId: string | null) {
  return nodes
    .filter((n) => n.parentDocId === parentId)
    .sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

function isFolder(n: DocTreeNode) {
  return isFolderDoc(n);
}

function ancestorIds(nodes: DocTreeNode[], docId: string): string[] {
  const out: string[] = [];
  let id: string | null = docId;
  while (id) {
    out.push(id);
    const node = nodes.find((n) => n.docId === id);
    id = node?.parentDocId ?? null;
  }
  return out;
}

export interface DocTreeNavProps {
  nodes: DocTreeNode[];
  groupId: string;
  activeId: string;
  onSelectNode?: (docId: string) => void;
  className?: string;
}

export function DocTreeNav({
  nodes,
  activeId,
  onSelectNode,
  className = "doc-tree-nav",
}: DocTreeNavProps) {
  const folderIds = useMemo(
    () => nodes.filter((n) => isFolder(n)).map((n) => n.docId),
    [nodes],
  );

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_DOC_ID]));

  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const id of ancestorIds(nodes, activeId)) next.add(id);
      return next;
    });
  }, [activeId, nodes]);

  const toggleExpanded = useCallback((docId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(docId)) next.delete(docId);
      else next.add(docId);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setExpanded(new Set(folderIds));
  }, [folderIds]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set([ROOT_DOC_ID]));
  }, []);

  function TreeBranch({ parentId, depth }: { parentId: string | null; depth: number }) {
    const children = childrenOf(nodes, parentId);
    if (children.length === 0) return null;

    return (
      <ul className={`${className}__list`} role="group">
        {children.map((n) => {
          const folder = isFolder(n);
          const kids = childrenOf(nodes, n.docId);
          const hasChildren = kids.length > 0;
          const open = expanded.has(n.docId);
          const showChildren = folder ? open && hasChildren : hasChildren;

          return (
            <li key={n.docId} className={`${className}__node`}>
              <div
                className={`${className}__row ${activeId === n.docId ? "is-active" : ""}`}
                style={{ paddingLeft: `${depth * 14 + 4}px` }}
              >
                {folder && hasChildren ? (
                  <button
                    type="button"
                    className={`${className}__chevron`}
                    aria-expanded={open}
                    aria-label={open ? "收起" : "展开"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleExpanded(n.docId);
                    }}
                  >
                    <span className={`${className}__chevron-icon ${open ? "is-open" : ""}`} />
                  </button>
                ) : (
                  <span className={`${className}__chevron ${className}__chevron--spacer`} />
                )}
                <button
                  type="button"
                  className={`${className}__item`}
                  onClick={() => onSelectNode?.(n.docId)}
                >
                  <span
                    className={`${className}__icon ${folder ? `${className}__icon--folder` : `${className}__icon--doc`}`}
                    aria-hidden
                  />
                  <span className={`${className}__label`} title={n.title}>
                    {n.title}
                  </span>
                </button>
              </div>
              {showChildren && <TreeBranch parentId={n.docId} depth={depth + 1} />}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <nav className={className} aria-label="文档目录">
      <div className={`${className}__header`}>
        <span className={`${className}__title`}>目录</span>
        <div className={`${className}__header-actions`}>
          <button type="button" className={`${className}__header-btn`} onClick={expandAll} title="全部展开">
            展开
          </button>
          <button type="button" className={`${className}__header-btn`} onClick={collapseAll} title="全部收起">
            收起
          </button>
        </div>
      </div>
      <TreeBranch parentId={null} depth={0} />
      {nodes.length === 0 && <p className={`${className}__empty`}>无可访问文档</p>}
    </nav>
  );
}

export { ROOT_DOC_ID };
'''

if __name__ == "__main__":
    p = ROOT / "apps/web/src/components/DocTreeNav.tsx"
    p.write_text(CONTENT, encoding="utf-8")
    print("DocTreeNav.tsx ok")
