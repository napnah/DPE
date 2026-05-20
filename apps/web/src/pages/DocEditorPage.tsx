import { Navigate, useParams } from "react-router-dom";

export default function DocEditorPage() {
  const { groupId, docId } = useParams<{ groupId: string; docId: string }>();
  const gid = groupId ?? "";
  const did = docId ?? "";
  return <Navigate to={`/groups/${gid}?doc=${encodeURIComponent(did)}`} replace />;
}
