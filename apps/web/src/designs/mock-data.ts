/** Static fixtures for design previews only — not wired to APIs. */

export type DesignVariant = "github" | "atlas" | "breeze";

export const ROLE_LABELS: Record<number, string> = {
  0: "不可见",
  1: "只读",
  2: "可写",
  3: "可操作",
};

export const CONTROL_MODE_LABELS: Record<string, string> = {
  owner_direct: "群主直连",
  proxy: "代理控制平面",
};

export interface MockIdentity {
  nodeId: string;
  displayName: string;
  publicKeyPreview: string;
  createdAt: string;
}

export interface MockGroup {
  group_id: string;
  name: string;
  control_mode: string;
  owner_node_id: string;
  proxy_base_url: string | null;
  created_at: string;
  memberCount: number;
}

export interface MockInvitation {
  id: string;
  groupName: string;
  inviterName: string;
  invitedAt: string;
}

export interface MockPeer {
  id: string;
  displayName: string;
  host: string;
  port: number;
  source: "mDNS" | "manual";
}

export interface MockDocNode {
  docId: string;
  parentDocId: string | null;
  title: string;
  keyVersion: number;
  isFolder?: boolean;
}

export interface MockMember {
  node_id: string;
  displayName: string;
  roleSummary: string;
  joinedAt: string;
}

export const MOCK_IDENTITY: MockIdentity = {
  nodeId: "a3f91c2e8b4d7019f6e2a1c5d8e9f0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6",
  displayName: "本机 · 实验室节点",
  publicKeyPreview: "MCowBQYDK2VwAyEA…k7Hx",
  createdAt: "2026-05-18",
};

export const MOCK_OWNED_GROUPS: MockGroup[] = [
  {
    group_id: "grp-course-2026",
    name: "软件工程课设 · 协作文档",
    control_mode: "proxy",
    owner_node_id: MOCK_IDENTITY.nodeId,
    proxy_base_url: "http://localhost:3001",
    created_at: "2026-04-02",
    memberCount: 4,
  },
  {
    group_id: "grp-lab-notes",
    name: "实验室笔记",
    control_mode: "owner_direct",
    owner_node_id: MOCK_IDENTITY.nodeId,
    proxy_base_url: null,
    created_at: "2026-03-11",
    memberCount: 2,
  },
];

export const MOCK_JOINED_GROUPS: MockGroup[] = [
  {
    group_id: "grp-shared-review",
    name: "期末评审资料",
    control_mode: "proxy",
    owner_node_id: "b1c2d3e4f5a6789012345678901234567890abcdef1234567890abcdef123456",
    proxy_base_url: "http://proxy.campus.local:3001",
    created_at: "2026-04-20",
    memberCount: 6,
  },
];

export const MOCK_INVITATIONS: MockInvitation[] = [
  {
    id: "inv-001",
    groupName: "分布式系统读书班",
    inviterName: "李老师",
    invitedAt: "2 小时前",
  },
];

export const MOCK_PEERS: MockPeer[] = [
  { id: "peer-1", displayName: "同桌 · 陈同学", host: "192.168.1.24", port: 3003, source: "mDNS" },
  { id: "peer-2", displayName: "邻组 · 王同学", host: "192.168.1.31", port: 3003, source: "mDNS" },
  { id: "peer-3", displayName: "手动添加节点", host: "10.0.0.8", port: 3003, source: "manual" },
];

export const MOCK_NETWORK = {
  status: "online",
  hostname: "DESKTOP-LAB",
  interfaces: ["Wi-Fi 5G", "Ethernet"],
  lanAgent: "http://localhost:3003",
  signaling: "ws://localhost:3002/ws",
};

export const MOCK_MEMBERS: MockMember[] = [
  {
    node_id: MOCK_IDENTITY.nodeId,
    displayName: "你（本机）",
    roleSummary: "群主 · 可操作",
    joinedAt: "2026-04-02",
  },
  {
    node_id: "b1c2d3e4f5a6789012345678901234567890abcdef1234567890abcdef123456",
    displayName: "陈同学",
    roleSummary: "可写",
    joinedAt: "2026-04-03",
  },
  {
    node_id: "c2d3e4f5a6789012345678901234567890abcdef1234567890abcdef12345678",
    displayName: "王同学",
    roleSummary: "只读",
    joinedAt: "2026-04-05",
  },
  {
    node_id: "d3e4f5a6789012345678901234567890abcdef1234567890abcdef1234567890",
    displayName: "访客节点",
    roleSummary: "不可见（示例）",
    joinedAt: "2026-04-10",
  },
];

export const MOCK_DOC_TREE: MockDocNode[] = [
  { docId: "root", parentDocId: null, title: "根目录", keyVersion: 2, isFolder: true },
  { docId: "folder-chapter1", parentDocId: "root", title: "第一章", keyVersion: 1, isFolder: true },
  { docId: "doc-requirements", parentDocId: "folder-chapter1", title: "需求说明", keyVersion: 1 },
  { docId: "doc-architecture", parentDocId: "root", title: "架构设计", keyVersion: 3 },
  { docId: "folder-archive", parentDocId: "root", title: "归档", keyVersion: 1, isFolder: true },
  { docId: "doc-meeting", parentDocId: "folder-archive", title: "会议纪要", keyVersion: 1 },
];

export type MockGroupCard = {
  group_id: string;
  name: string;
  description: string;
  my_role_name: string;
  my_role_color: string;
  is_owner: boolean;
};

export const MOCK_ALL_GROUPS: MockGroupCard[] = [
  {
    group_id: "grp-course-2026",
    name: "软件工程课设 · 协作文档",
    description: "课程项目协作文档、需求与设计稿集中存放。",
    my_role_name: "群主",
    my_role_color: "#9a6700",
    is_owner: true,
  },
  {
    group_id: "grp-lab-notes",
    name: "实验室笔记",
    description: "实验记录与临时笔记。",
    my_role_name: "管理员",
    my_role_color: "#0969da",
    is_owner: true,
  },
  {
    group_id: "grp-shared-review",
    name: "期末评审资料",
    description: "评审材料与答辩提纲。",
    my_role_name: "读者",
    my_role_color: "#656d76",
    is_owner: false,
  },
];

export const MOCK_GROUP_ROLES = [
  { id: "role-admin", name: "管理员", color: "#0969da" },
  { id: "role-collab", name: "协作者", color: "#1a7f37" },
  { id: "role-reader", name: "读者", color: "#656d76" },
];

export const MOCK_DOC_ROLE_ACLS = [
  { roleId: "role-admin", name: "管理员", color: "#0969da", access_level: 3 },
  { roleId: "role-collab", name: "协作者", color: "#1a7f37", access_level: 2 },
  { roleId: "role-reader", name: "读者", color: "#656d76", access_level: 1 },
];

export const MOCK_EDITOR_CONTENT =
  "# 需求说明（设计预览）\n\n本页面为前端设计风格展示，数据均为模拟。\n\n- 支持 Yjs 协作编辑\n- SignedUpdate 经 P2P 加密同步\n- 权限在「权限」面板中按文档配置";

export function memberByNodeId(nodeId: string): MockMember | undefined {
  return MOCK_MEMBERS.find((m) => m.node_id === nodeId);
}

export function shortId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}
