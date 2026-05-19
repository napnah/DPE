import { useParams } from "react-router-dom";

export default function GroupPage() {
  const { groupId } = useParams();
  return (
    <main style={{ padding: "2rem" }}>
      <h1>群组: {groupId}</h1>
      <p>文档树与富文本编辑器（P5）</p>
    </main>
  );
}
