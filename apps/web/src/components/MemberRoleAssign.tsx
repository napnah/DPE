import { useEffect, useId, useRef, useState } from "react";

export type GroupRoleOption = {
  id: string;
  name: string;
  color: string;
};

export function MemberRoleAssign({
  roles,
  assignedRoleIds,
  disabled,
  onChange,
}: {
  roles: GroupRoleOption[];
  assignedRoleIds: string[];
  disabled?: boolean;
  onChange: (roleIds: string[]) => void;
}) {
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const roleById = Object.fromEntries(roles.map((r) => [r.id, r]));
  const assigned = assignedRoleIds
    .map((id) => roleById[id])
    .filter((r): r is GroupRoleOption => Boolean(r));
  const available = roles.filter((r) => !assignedRoleIds.includes(r.id));

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  function removeRole(roleId: string) {
    onChange(assignedRoleIds.filter((id) => id !== roleId));
  }

  function addRole(roleId: string) {
    if (assignedRoleIds.includes(roleId)) return;
    onChange([...assignedRoleIds, roleId]);
    setMenuOpen(false);
  }

  return (
    <div className="app-member-roles" ref={rootRef}>
      <div className="app-member-roles__tags">
        {assigned.length === 0 && <span className="app-muted app-member-roles__empty">暂无角色</span>}
        {assigned.map((r) => (
          <span
            key={r.id}
            className="app-role-tag"
            style={{ borderColor: r.color, color: r.color, background: `${r.color}14` }}
          >
            <span className="app-role-tag__name">{r.name}</span>
            <button
              type="button"
              className="app-role-tag__remove"
              disabled={disabled}
              aria-label={`移除角色 ${r.name}`}
              onClick={() => removeRole(r.id)}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="app-member-roles__add">
        <button
          type="button"
          className="app-btn app-btn--small app-member-roles__add-btn"
          disabled={disabled || available.length === 0}
          aria-expanded={menuOpen}
          aria-haspopup="listbox"
          aria-controls={menuId}
          onClick={() => setMenuOpen((v) => !v)}
        >
          添加
          <span className="app-member-roles__caret" aria-hidden>
            ▾
          </span>
        </button>
        {menuOpen && available.length > 0 && (
          <ul id={menuId} className="app-role-add-menu" role="listbox">
            {available.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  role="option"
                  className="app-role-add-menu__item"
                  disabled={disabled}
                  onClick={() => addRole(r.id)}
                >
                  <span className="app-role-add-menu__dot" style={{ background: r.color }} />
                  {r.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
