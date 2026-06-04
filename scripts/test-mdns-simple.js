/**
 * 简单 mDNS 多播测试
 * 检测 UDP 5353 多播是否能在指定接口上工作
 */

const dgram = require("dgram");

const MDNS_MULTICAST_ADDR = "224.0.0.251";
const MDNS_PORT = 5353;
const interfaceIp = process.argv[2] || "0.0.0.0";

console.log("=== mDNS 多播连通性测试 ===");
console.log(`绑定接口: ${interfaceIp}`);
console.log(`多播地址: ${MDNS_MULTICAST_ADDR}:${MDNS_PORT}`);
console.log("");

// 创建 UDP socket
const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });

socket.on("error", (err) => {
  console.error("Socket 错误:", err.message);
  socket.close();
  process.exit(1);
});

socket.on("message", (msg, rinfo) => {
  console.log(`[收到 mDNS 响应] 来自 ${rinfo.address}:${rinfo.port}, 大小 ${msg.length} 字节`);
});

socket.bind(MDNS_PORT, interfaceIp, () => {
  console.log("1. Socket 已绑定到端口", MDNS_PORT);

  // 加入多播组
  try {
    socket.addMembership(MDNS_MULTICAST_ADDR, interfaceIp);
    console.log("2. 已加入多播组", MDNS_MULTICAST_ADDR);
  } catch (e) {
    console.error("   加入多播组失败:", e.message);
    console.log("   这可能意味着防火墙阻止了多播，或接口不支持多播。");
    socket.close();
    process.exit(1);
  }

  // 构造一个简单的 mDNS 查询包 (查询 _dpe-agent._tcp.local)
  const queryPacket = Buffer.from([
    0x00, 0x00, // Transaction ID
    0x00, 0x00, // Flags: standard query
    0x00, 0x01, // Questions: 1
    0x00, 0x00, // Answer RRs
    0x00, 0x00, // Authority RRs
    0x00, 0x00, // Additional RRs
    // Query: _dpe-agent._tcp.local
    0x0a, 0x5f, 0x64, 0x70, 0x65, 0x2d, 0x61, 0x67, 0x65, 0x6e, 0x74, // _dpe-agent
    0x04, 0x5f, 0x74, 0x63, 0x70, // _tcp
    0x05, 0x6c, 0x6f, 0x63, 0x61, 0x6c, // local
    0x00,     // end of name
    0x00, 0x0c, // Type: PTR
    0x00, 0x01, // Class: IN
  ]);

  console.log("3. 发送 mDNS 查询包...");

  socket.send(queryPacket, 0, queryPacket.length, MDNS_PORT, MDNS_MULTICAST_ADDR, (err) => {
    if (err) {
      console.error("   发送失败:", err.message);
    } else {
      console.log("   查询已发送到", MDNS_MULTICAST_ADDR + ":" + MDNS_PORT);
    }
  });

  // 等待响应
  console.log("4. 等待 mDNS 响应 (5 秒)...");
  console.log("");

  setTimeout(() => {
    console.log("=== 测试结果 ===");
    console.log("如果看到 '[收到 mDNS 响应]' 消息，说明 mDNS 多播工作正常。");
    console.log("如果没有收到响应，可能原因:");
    console.log("  1. 对端节点未运行或未发布 mDNS 服务");
    console.log("  2. 防火墙阻止了 UDP 5353 多播");
    console.log("  3. Host-Only 网络不支持多播");
    console.log("");
    console.log("建议:");
    console.log("  - 在虚拟机上启动 lan-agent: pnpm --filter @dpe/lan-agent dev");
    console.log("  - 临时关闭 Windows 防火墙测试:");
    console.log("    netsh advfirewall set allprofiles state off");
    console.log("  - 测试完成后记得开启: netsh advfirewall set allprofiles state on");

    socket.close();
    process.exit(0);
  }, 5000);
});
