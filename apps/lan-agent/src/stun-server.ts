import dgram from "node:dgram";

// Minimal RFC 5389 STUN server: answers Binding Requests with a XOR-MAPPED-ADDRESS.
// This is intentionally dependency-free. On a VMware Host-Only LAN, browsers refuse to
// expose raw host-IP candidates (mDNS obfuscation in Chromium, host-candidate quirks in
// Firefox), so peers never form a candidate pair with iceServers:[]. A LAN-reachable STUN
// server lets every browser gather a server-reflexive candidate with its REAL IP, which is
// never obfuscated, so ICE succeeds across browsers without any per-browser config flags.

const STUN_BINDING_REQUEST = 0x0001;
const STUN_BINDING_RESPONSE = 0x0101;
const STUN_MAGIC_COOKIE = 0x2112a442;
const XOR_MAPPED_ADDRESS = 0x0020;

function buildBindingResponse(txid: Buffer, address: string, port: number): Buffer | null {
  const parts = address.split(".").map((n) => Number.parseInt(n, 10));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return null;
  }
  const attr = Buffer.alloc(12);
  attr.writeUInt16BE(XOR_MAPPED_ADDRESS, 0);
  attr.writeUInt16BE(8, 2);
  attr.writeUInt8(0, 4);
  attr.writeUInt8(0x01, 5);
  attr.writeUInt16BE((port ^ (STUN_MAGIC_COOKIE >>> 16)) & 0xffff, 6);
  const ipNum = (((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0) ^ STUN_MAGIC_COOKIE;
  attr.writeUInt32BE(ipNum >>> 0, 8);

  const header = Buffer.alloc(20);
  header.writeUInt16BE(STUN_BINDING_RESPONSE, 0);
  header.writeUInt16BE(attr.length, 2);
  header.writeUInt32BE(STUN_MAGIC_COOKIE, 4);
  txid.copy(header, 8);
  return Buffer.concat([header, attr]);
}

export function startStunServer(port: number): dgram.Socket {
  const sock = dgram.createSocket("udp4");
  sock.on("message", (msg, rinfo) => {
    if (msg.length < 20) return;
    if (msg.readUInt16BE(0) !== STUN_BINDING_REQUEST) return;
    if (msg.readUInt32BE(4) !== STUN_MAGIC_COOKIE) return;
    const txid = msg.subarray(8, 20);
    const res = buildBindingResponse(txid, rinfo.address, rinfo.port);
    if (res) sock.send(res, rinfo.port, rinfo.address);
  });
  sock.on("error", (err) => {
    console.error(`[stun] socket error: ${(err as Error).message}`);
  });
  sock.bind(port, "0.0.0.0", () => {
    console.log(`[stun] listening udp 0.0.0.0:${port}`);
  });
  return sock;
}
