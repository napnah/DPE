import { Link } from "react-router-dom";

export type GroupCardData = {
  group_id: string;
  name: string;
  description?: string;
  my_role_name: string;
  my_role_color: string;
  is_owner: boolean;
};

const GRADIENTS = [
  "linear-gradient(135deg, #1a1f3a 0%, #3d5a80 100%)",
  "linear-gradient(135deg, #f8f9fa 0%, #e8eef4 100%)",
  "linear-gradient(135deg, #4a5568 0%, #a0aec0 100%)",
  "linear-gradient(135deg, #2d3748 0%, #718096 100%)",
  "linear-gradient(135deg, #ebf4ff 0%, #c3dafe 100%)",
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
  const light = gradient.includes("#f8f9fa") || gradient.includes("#ebf4ff");
  const textColor = light ? "#1f2328" : "#ffffff";

  return (
    <Link to={to ?? `/groups/${group.group_id}`} className="group-card">
      <div className="group-card__visual" style={{ background: gradient }}>
        <span
          className="group-card__badge"
          style={{ background: group.my_role_color, color: "#fff" }}
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
