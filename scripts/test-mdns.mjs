#!/usr/bin/env node
/**
 * mDNS 邻居发现测试脚本
 * 用法: node scripts/test-mdns.mjs [interface-ip]
 */

import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

// 从 lan-agent 的 node_modules 中加载
const { Bonjour } = require("bonjour-service");

const SERVICE_TYPE = "dpe-agent";
const interfaceIp = process.argv[2] || "";
const testUid = `test-${Date.now()}`;
const testPort = 19999;

console.log("=== mDNS 邻居发现测试 ===");
console.log(`服务类型: ${SERVICE_TYPE}`);
console.log(`测试节点 UID: ${testUid}`);
console.log(`绑定接口: ${interfaceIp || "(所有接口)"}`);
console.log("");

// 创建 Bonjour 实例
const bonjour = new Bonjour(
  interfaceIp ? { interface: interfaceIp } : undefined
);

// 发布测试服务
console.log("1. 发布测试 mDNS 服务...");
const service = bonjour.publish({
  name: `DPE-Test-${testUid.slice(0, 8)}`,
  type: SERVICE_TYPE,
  port: testPort,
  txt: { uid: testUid, host: interfaceIp || "localhost" },
});
console.log("   服务已发布。");

// 浏览同类型服务
console.log("2. 开始浏览 mDNS 服务...");
const browser = bonjour.find({ type: SERVICE_TYPE });

const discovered = new Map();

browser.on("up", (svc) => {
  const uid = svc.txt?.uid ?? svc.name;
  const host =
    svc.referer?.address ??
    svc.txt?.host ??
    svc.host ??
    svc.addresses?.[0];

  discovered.set(uid, {
    uid,
    name: svc.name,
    host,
    port: svc.port,
    addresses: svc.addresses,
  });

  console.log(`   [发现] ${svc.name} (${uid}) @ ${host}:${svc.port}`);
});

browser.on("down", (svc) => {
  const uid = svc.txt?.uid ?? svc.name;
  discovered.delete(uid);
  console.log(`   [离开] ${svc.name} (${uid})`);
});

// 等待一段时间收集结果
const WAIT_SECONDS = 8;
console.log(`3. 等待 ${WAIT_SECONDS} 秒收集结果...`);
console.log("");

setTimeout(() => {
  console.log("=== 测试结果 ===");
  console.log(`发现 ${discovered.size} 个邻居:`);

  if (discovered.size === 0) {
    console.log("");
    console.log("未发现任何邻居。可能原因:");
    console.log("  1. 对端节点未运行 lan-agent");
    console.log("  2. mDNS 绑定的接口不正确");
    console.log("  3. 防火墙阻止了 UDP 5353 端口 (多播)");
    console.log("  4. 虚拟机网络不在同一广播域");
    console.log("");
    console.log("建议:");
    console.log("  - 在虚拟机上运行: pnpm --filter @dpe/lan-agent dev");
    console.log("  - 确保 .env 中 DPE_MDNS_INTERFACE 设置正确");
    console.log("  - 检查 Windows 防火墙是否允许 UDP 5353 入站/出站");
    console.log("  - 临时关闭防火墙测试: netsh advfirewall set allprofiles state off");
  } else {
    for (const [uid, peer] of discovered) {
      console.log(`  - ${peer.name} (${uid})`);
      console.log(`    地址: ${peer.host}:${peer.port}`);
      console.log(`    所有地址: ${peer.addresses?.join(", ") ?? "未知"}`);
    }
  }

  // 清理
  console.log("");
  console.log("清理测试资源...");
  service.stop();
  browser.stop();
  bonjour.destroy();

  console.log("测试完成。");
  process.exit(0);
}, WAIT_SECONDS * 1000);
