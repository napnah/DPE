import { Navigate, useOutletContext, useParams } from "react-router-dom";
import type { DesignOutletContext } from "../DesignLayout";

/** 设计预览：文档编辑已合并到群组页 */
export default function EditorScreen() {
  const { groupId, docId } = useParams<{ groupId: string; docId: string }>();
  const { base } = useOutletContext<DesignOutletContext>();
  const gid = groupId ?? "grp-course-2026";
  const did = docId ?? "doc-requirements";
  return <Navigate to={`${base}/groups/${gid}?doc=${encodeURIComponent(did)}`} replace />;
}
