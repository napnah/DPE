import { Link } from "react-router-dom";

export type GroupCardData = {
  group_id: string;
  name: string;
  description?: string;
  my_role_name: string;
  my_role_color: string;
  is_owner: boolean;
  control_plane_url?: string;
};

/** Breeze-style soft surfaces (no heavy dark tiles). */
const GRADIENTS = [
  "linear-gradient(165deg, #e8f4fc 0%, #d4ebf8 100%)",
  "linear-gradient(165deg, #f5f6f7 0%, #ebedef 100%)",
  "linear-gradient(165deg, #eef6fa 0%, #dceef7 100%)",
  "linear-gradient(165deg, #f0f2f4 0%, #e2e6ea 100%)",
  "linear-gradient(165deg, #e3f2fd 0%, #cfe8f6 100%)",
];

function pickGradient(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i)) % GRADIENTS.length;
  return GRADIENTS[h]!;
}

export function GroupCard({
  group,
  to,
}: {
  group: GroupCardData;
  /** Override link target (design previews use /designs/:variant/...) */
  to?: string;
}) {
  const gradient = pickGradient(group.group_id);
  const textColor = "#232629";
  const badgeStyle = group.is_owner
    ? {
        background: "linear-gradient(135deg, #f7d36b 0%, #d99a22 100%)",
        color: "#3f2b05",
      }
    : { background: group.my_role_color, color: "#fff" };

  const target =
    to ??
    (group.control_plane_url
      ? `/groups/${group.group_id}?control=${encodeURIComponent(group.control_plane_url)}`
      : `/groups/${group.group_id}`);

  return (
    <Link to={target} className="group-card">
      <div className="group-card__visual" style={{ background: gradient }}>
        <span
          className="group-card__badge"
          style={badgeStyle}
        >
          {group.my_role_name}
        </span>
        <h3 className="group-card__title" style={{ color: textColor }}>
          {group.name}
        </h3>
      </div>
      <div className="group-card__hover">
        <p>{group.description || "暂无群组描述"}</p>
      </div>
    </Link>
  );
}
