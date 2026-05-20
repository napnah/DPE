import { ROOT_DOC_ID, isFolderDoc } from "@dpe/shared";

export type DocTreeNode = {
  docId: string;
  parentDocId: string | null;
  title: string;
  isFolder?: boolean;
};

function childrenOf(nodes: DocTreeNode[], parentId: string | null) {
  return nodes.filter((n) => n.parentDocId === parentId);
}

function isFolder(n: DocTreeNode) {
  return isFolderDoc(n);
}

export interface DocTreeNavProps {
  nodes: DocTreeNode[];
  groupId: string;
  activeId: string;
  /** Same-page selection (folders and documents) */
  onSelectNode?: (docId: string) => void;
  className?: string;
}

export function DocTreeNav({
  nodes,
  activeId,
  onSelectNode,
  className = "doc-tree-nav",
}: DocTreeNavProps) {
  function TreeLevel({ parentId, depth = 0 }: { parentId: string | null; depth?: number }) {
    const children = childrenOf(nodes, parentId);
    if (children.length === 0) return null;
    return (
      <ul className={`${className}__list`} style={{ paddingLeft: depth ? 12 : 0 }}>
        {children.map((n) => (
          <li key={n.docId}>
            <button
              type="button"
              className={`${className}__item ${activeId === n.docId ? "is-active" : ""}`}
              onClick={() => onSelectNode?.(n.docId)}
            >
              <span className={`${className}__icon`} aria-hidden>
                {isFolder(n) ? "📁" : "📄"}
              </span>
              {n.title}
            </button>
            <TreeLevel parentId={n.docId} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }

  return (
    <nav className={className} aria-label="文档树">
      <TreeLevel parentId={null} />
      {nodes.length === 0 && <p className={`${className}__empty`}>无可见文档</p>}
    </nav>
  );
}

export { ROOT_DOC_ID };
