import {
  AuthHandshakeError,
  serializeAuthEnvelope,
  validateAuthEnvelopeWithPeerKey,
  type AuthenticatedPeer,
} from "@dpe/p2p";
import type { AuthEnvelope } from "@dpe/proto";
import { authEnvelopeSchema } from "@dpe/proto";
import { SecureYjsProvider, type PeerSession } from "@dpe/yjs-provider";
import { base64UrlToBytes, parseJwtPayload } from "@dpe/crypto";
import {
  markRealtimeAuthError,
  markRealtimePeerStats,
  markRealtimeRx,
  markRealtimeTx,
} from "./realtime-debug";
import { traceRealtime } from "./realtime-trace.js";

function signalingUrl(): string {
  const raw = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:3002/ws";
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
}

/** Decode the JWT (without verifying signature) to suggest the most likely failure cause. */
function diagnoseJwtFailure(jwt: string, peerId: string, audience: string): string | null {
  try {
    const payload = parseJwtPayload(jwt);
    const now = Math.floor(Date.now() / 1000);
    if (payload.aud !== audience) return `aud_mismatch(got=${payload.aud})`;
    if (payload.sub !== peerId) return "sub_mismatch";
    if (typeof payload.exp === "number" && payload.exp < now) return "expired";
    return "signature_or_unknown";
  } catch {
    return "jwt_undecodable";
  }
}

export type MeshConfig = {
  groupId: string;
  nodeId: string;
  adminPublicKeyBase64Url: string;
  memberPublicKeys: Map<string, string>;
  getJwt: () => Promise<string>;
};

export class GroupP2pMesh {
  private ws: WebSocket | null = null;
  private readonly pcs = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  private readonly providers = new Set<SecureYjsProvider>();
  private readonly authenticated = new Map<string, AuthenticatedPeer>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly connecting = new Set<string>();
  private readonly lastAlive = new Map<string, number>();
  private readonly currentRoomPeers = new Set<string>();
  private lastPeersInRoom = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly HEALTH_INTERVAL_MS = 5_000;
  private static readonly PONG_TIMEOUT_MS = 15_000;
  private static readonly DPE_PING = "__dpe_ping__";
  private static readonly DPE_PONG = "__dpe_pong__";

  private static classifyWireMessage(text: string): string {
    if (text === GroupP2pMesh.DPE_PING) return "ping";
    if (text === GroupP2pMesh.DPE_PONG) return "pong";
    try {
      const json = JSON.parse(text) as Record<string, unknown>;
      if (json && typeof json === "object") {
        if ("jwt" in json && "node_id" in json) return "auth_envelope";
        if (json.type === "sync" && json.update && typeof json.update === "object") {
          return "signed_update";
        }
        if ("ciphertext" in json || "ciphertext_b64" in json) return "signed_update";
        if ("kind" in json) return `signal_${String(json.kind)}`;
      }
      return "json_other";
    } catch {
      return "opaque";
    }
  }

  constructor(private readonly config: MeshConfig) {}

  /** Lower node_id always initiates the WebRTC offer for a pair. */
  private shouldInitiate(peerId: string): boolean {
    return this.config.nodeId < peerId;
  }

  private notePeerAlive(peerId: string): void {
    this.lastAlive.set(peerId, Date.now());
  }

  private startHealthLoop(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => this.runHealthCheck(), GroupP2pMesh.HEALTH_INTERVAL_MS);
  }

  private runHealthCheck(): void {
    const now = Date.now();

    // 1. Heartbeat: send ping and reap peers that stop responding.
    for (const [peerId, ch] of this.channels) {
      if (peerId === this.config.nodeId) {
        this.cleanupPeer(peerId);
        continue;
      }
      if (ch.readyState !== "open") continue;

      try {
        ch.send(GroupP2pMesh.DPE_PING);
      } catch {
        markRealtimeAuthError(`channel_send_failed:${peerId.slice(0, 6)}`);
        traceRealtime("mesh", "health_ping_failed", { peer: peerId.slice(0, 12) }, "warn");
        this.cleanupPeer(peerId);
        continue;
      }

      const seen = this.lastAlive.get(peerId) ?? 0;
      if (seen > 0 && now - seen > GroupP2pMesh.PONG_TIMEOUT_MS) {
        markRealtimeAuthError(`channel_silent:${peerId.slice(0, 6)}`);
        traceRealtime("mesh", "channel_silent", { peer: peerId.slice(0, 12) }, "warn");
        this.cleanupPeer(peerId);
      }
    }

    // 2. Tear down any pc that is already in failed/closed state.
    for (const [peerId, pc] of this.pcs) {
      const st = pc.connectionState;
      if (st === "failed" || st === "closed") this.cleanupPeer(peerId);
    }

    // 3. Reconcile against signaling's latest peer list.
    if (this.ws?.readyState === WebSocket.OPEN) {
      for (const peerId of this.currentRoomPeers) {
        if (peerId === this.config.nodeId) continue;
        const ch = this.channels.get(peerId);
        const pc = this.pcs.get(peerId);
        const channelOpen = ch?.readyState === "open";
        const pcLive =
          pc?.connectionState === "connected" ||
          pc?.connectionState === "connecting" ||
          pc?.connectionState === "new";
        if (!channelOpen && !pcLive && !this.connecting.has(peerId)) {
          if (pc) this.cleanupPeer(peerId);
          if (this.shouldInitiate(peerId)) {
            void this.connectPeer(peerId);
          }
        }
      }
    }

    this.emitPeerStats();
  }

  private emitPeerStats(peersInRoom?: number): void {
    if (typeof peersInRoom === "number") {
      this.lastPeersInRoom = Math.max(0, peersInRoom);
    }
    let channelsOpen = 0;
    for (const ch of this.channels.values()) {
      if (ch.readyState === "open") channelsOpen += 1;
    }
    markRealtimePeerStats({
      peersInRoom: this.lastPeersInRoom,
      channelsOpen,
      authedPeers: this.authenticated.size,
    });
  }

  attachProvider(provider: SecureYjsProvider): void {
    this.providers.add(provider);
    for (const peer of this.authenticated.values()) {
      try {
        provider.registerPeer(this.toPeerSession(peer));
      } catch {
        /* pk map may lag */
      }
    }
  }

  detachProvider(provider: SecureYjsProvider): void {
    this.providers.delete(provider);
  }

  broadcast(text: string): void {
    const bytes = new TextEncoder().encode(text).byteLength;
    const kind = GroupP2pMesh.classifyWireMessage(text);
    let sent = 0;
    for (const ch of this.channels.values()) {
      if (ch.readyState !== "open") continue;
      try {
        ch.send(text);
        markRealtimeTx(bytes);
        sent += 1;
      } catch {
        markRealtimeAuthError("broadcast_send_failed");
        traceRealtime("mesh", "broadcast_send_failed", { kind, bytes }, "error");
      }
    }
    if (kind === "signed_update") {
      traceRealtime("yjs", "wire_tx", { kind, bytes, channels: sent }, "debug");
    }
  }

  async start(): Promise<void> {
    const url = signalingUrl();
    this.ws = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      let settled = false;
      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        reject(new Error(message));
      };
      const ok = () => {
        if (settled) return;
        settled = true;
        resolve();
      };

      const timeout = window.setTimeout(() => {
        fail(`信令连接超时，请确认 signaling 已启动 (${url})`);
      }, 10_000);

      ws.onopen = () => {
        window.clearTimeout(timeout);
        ws.onclose = null;
        ws.onerror = null;
        traceRealtime("signal", "ws_open", { url }, "info");
        ok();
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        fail(`无法连接信令服务，请运行 pnpm dev 或检查 ${url}`);
      };
      ws.onclose = () => {
        window.clearTimeout(timeout);
        fail(`信令连接已关闭 (${url})`);
      };
    });

    this.ws.onmessage = (ev) => void this.onSignalMessage(String(ev.data));
    this.ws.send(
      JSON.stringify({
        type: "join",
        room: this.config.groupId,
        node_id: this.config.nodeId,
      }),
    );

    this.startHealthLoop();
  }

  stop(): void {
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    this.ws?.close();
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();
    for (const pc of this.pcs.values()) pc.close();
    this.pcs.clear();
    this.channels.clear();
    this.authenticated.clear();
    this.providers.clear();
    this.lastAlive.clear();
    this.pendingCandidates.clear();
    this.connecting.clear();
    this.currentRoomPeers.clear();
    this.emitPeerStats(0);
  }

  private cleanupPeer(peerId: string): void {
    if (peerId === this.config.nodeId) return;
    traceRealtime("mesh", "cleanup_peer", { peer: peerId.slice(0, 12) }, "info");

    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
    const pc = this.pcs.get(peerId);
    if (pc) {
      pc.onconnectionstatechange = null;
      pc.onicecandidate = null;
      pc.ondatachannel = null;
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    this.pcs.delete(peerId);
    const ch = this.channels.get(peerId);
    if (ch) {
      ch.onopen = null;
      ch.onclose = null;
      ch.onmessage = null;
      try {
        ch.close();
      } catch {
        /* ignore */
      }
    }
    this.channels.delete(peerId);
    this.authenticated.delete(peerId);
    this.lastAlive.delete(peerId);
    this.pendingCandidates.delete(peerId);
    for (const p of this.providers) p.unregisterPeer(peerId);
    this.emitPeerStats();
  }

  private toPeerSession(auth: AuthenticatedPeer): PeerSession {
    const pkB64 = this.config.memberPublicKeys.get(auth.nodeId);
    if (!pkB64) throw new Error(`unknown peer pk: ${auth.nodeId}`);
    return {
      nodeId: auth.nodeId,
      role: auth.payload.role as 0 | 1 | 2 | 3,
      publicKey: base64UrlToBytes(pkB64),
      keyVersion: auth.payload.key_version,
      jwt: auth.jwt,
      payload: auth.payload,
    };
  }

  private onPeerAuthed(peer: AuthenticatedPeer): void {
    if (this.authenticated.has(peer.nodeId)) return;
    traceRealtime("auth", "peer_authed", {
      peer: peer.nodeId.slice(0, 12),
      role: peer.payload.role,
      docId: peer.payload.doc_id,
    });
    this.authenticated.set(peer.nodeId, peer);
    try {
      const session = this.toPeerSession(peer);
      for (const p of this.providers) p.registerPeer(session);
      this.emitPeerStats();
    } catch (e) {
      traceRealtime(
        "auth",
        "register_peer_failed",
        {
          peer: peer.nodeId.slice(0, 12),
          error: e instanceof Error ? e.message : String(e),
        },
        "warn",
      );
    }
  }

  private async onSignalMessage(raw: string): Promise<void> {
    const msg = JSON.parse(raw) as {
      type: string;
      peers?: string[];
      payload?: Record<string, unknown>;
    };

    if (msg.type === "peers" && msg.peers) {
      this.currentRoomPeers.clear();
      for (const p of msg.peers) this.currentRoomPeers.add(p);
      traceRealtime("signal", "room_peers", {
        count: msg.peers.length,
        peers: msg.peers.map((p) => p.slice(0, 8)),
      });
      this.emitPeerStats(Math.max(0, msg.peers.length - 1));
      for (const peerId of msg.peers) {
        if (peerId === this.config.nodeId) continue;
        const existing = this.pcs.get(peerId);
        const ch = this.channels.get(peerId);
        if (existing) {
          const st = existing.connectionState;
          if (st === "failed" || st === "closed") {
            this.cleanupPeer(peerId);
          } else if (ch?.readyState === "open") {
            continue;
          } else if (st === "connected" || st === "connecting" || st === "new") {
            continue;
          }
        }
        if (!this.shouldInitiate(peerId)) continue;
        void this.connectPeer(peerId);
      }
      return;
    }

    if (msg.type !== "signal" || !msg.payload) return;
    const from = String(msg.payload.from ?? "");
    if (!from || from === this.config.nodeId) return;

    if (msg.payload.kind === "offer" && msg.payload.sdp) {
      // Perfect negotiation: lower node_id is always initiator.
      if (this.shouldInitiate(from)) return;

      let pc = this.pcs.get(from);
      if (!pc) {
        await this.connectPeer(from, false);
        pc = this.pcs.get(from);
        if (!pc) return;
      }

      await pc.setRemoteDescription(
        new RTCSessionDescription(msg.payload.sdp as RTCSessionDescriptionInit),
      );
      await this.flushCandidates(from, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(from, { kind: "answer", sdp: answer });
      return;
    }

    const pc = this.pcs.get(from);
    if (!pc) return;

    if (msg.payload.kind === "answer" && msg.payload.sdp) {
      if (pc.signalingState !== "have-local-offer") return;
      await pc.setRemoteDescription(
        new RTCSessionDescription(msg.payload.sdp as RTCSessionDescriptionInit),
      );
      await this.flushCandidates(from, pc);
    } else if (msg.payload.kind === "candidate" && msg.payload.candidate) {
      const candidate = msg.payload.candidate as RTCIceCandidateInit;
      if (pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch {
          /* ignore */
        }
      } else {
        const queue = this.pendingCandidates.get(from) ?? [];
        queue.push(candidate);
        this.pendingCandidates.set(from, queue);
      }
    }
  }

  private async flushCandidates(peerId: string, pc: RTCPeerConnection): Promise<void> {
    const pending = this.pendingCandidates.get(peerId);
    if (!pending?.length) return;
    this.pendingCandidates.delete(peerId);
    for (const candidate of pending) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch {
        /* ignore */
      }
    }
  }

  private sendSignal(to: string, payload: Record<string, unknown>): void {
    this.ws?.send(
      JSON.stringify({
        type: "signal",
        room: this.config.groupId,
        to,
        payload,
      }),
    );
  }

  private async connectPeer(peerId: string, initiator = this.shouldInitiate(peerId)): Promise<void> {
    if (peerId === this.config.nodeId) return;
    if (initiator !== this.shouldInitiate(peerId)) return;
    if (this.connecting.has(peerId)) return;
    traceRealtime("mesh", "connect_peer", { peer: peerId.slice(0, 12), initiator }, "info");

    const existing = this.pcs.get(peerId);
    const existingChannel = this.channels.get(peerId);
    if (
      existing &&
      (existing.connectionState === "connected" || existing.connectionState === "connecting") &&
      (existingChannel?.readyState === "open" || existingChannel?.readyState === "connecting")
    ) {
      return;
    }

    this.connecting.add(peerId);
    this.cleanupPeer(peerId);

    try {
      const pc = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      });
      this.pcs.set(peerId, pc);

      pc.onconnectionstatechange = () => {
        const st = pc.connectionState;
        traceRealtime("mesh", "pc_state", { peer: peerId.slice(0, 12), state: st }, "debug");
        if (st === "connected") {
          const pending = this.reconnectTimers.get(peerId);
          if (pending) {
            clearTimeout(pending);
            this.reconnectTimers.delete(peerId);
          }
          return;
        }

        if (st === "failed" || st === "closed") {
          this.cleanupPeer(peerId);
          if (this.ws?.readyState === WebSocket.OPEN && this.shouldInitiate(peerId)) {
            void this.connectPeer(peerId);
          }
          return;
        }

        if (st === "disconnected") {
          if (this.reconnectTimers.has(peerId)) return;
          const timer = setTimeout(() => {
            this.reconnectTimers.delete(peerId);
            const current = this.pcs.get(peerId);
            if (!current || current.connectionState !== "disconnected") return;
            this.cleanupPeer(peerId);
            if (this.ws?.readyState === WebSocket.OPEN && this.shouldInitiate(peerId)) {
              void this.connectPeer(peerId);
            }
          }, 4000);
          this.reconnectTimers.set(peerId, timer);
        }
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          this.sendSignal(peerId, { kind: "candidate", candidate: ev.candidate.toJSON() });
        }
      };

      if (initiator) {
        const channel = pc.createDataChannel("dpe", { ordered: true });
        this.wireChannel(peerId, channel);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        this.sendSignal(peerId, { kind: "offer", sdp: offer });
      } else {
        pc.ondatachannel = (ev) => {
          if (ev.channel.label !== "dpe") return;
          if (this.channels.has(peerId)) return;
          this.wireChannel(peerId, ev.channel);
        };
      }
    } finally {
      this.connecting.delete(peerId);
    }
  }

  private wireChannel(peerId: string, channel: RTCDataChannel): void {
    if (peerId === this.config.nodeId) return;

    const prev = this.channels.get(peerId);
    if (prev && prev !== channel) {
      prev.onopen = null;
      prev.onclose = null;
      prev.onmessage = null;
      try {
        prev.close();
      } catch {
        /* ignore */
      }
    }

    this.channels.set(peerId, channel);
    let sentAuth = false;

    const sendAuth = async () => {
      if (sentAuth) return;
      if (channel.readyState !== "open") {
        markRealtimeAuthError("auth_not_open_before_jwt");
        return;
      }
      const jwt = await this.config.getJwt();
      if (channel.readyState !== "open") {
        markRealtimeAuthError("auth_not_open_after_jwt");
        return;
      }
      const envelope: AuthEnvelope = {
        type: "auth",
        node_id: this.config.nodeId,
        jwt,
      };
      try {
        channel.send(serializeAuthEnvelope(envelope));
        sentAuth = true;
      } catch {
        markRealtimeAuthError("auth_send_failed");
      }
    };

    channel.onopen = () => {
      traceRealtime("mesh", "channel_open", { peer: peerId.slice(0, 12) }, "info");
      this.notePeerAlive(peerId);
      this.emitPeerStats();
      void sendAuth().catch(() => {
        /* ignore auth race errors */
      });
    };
    channel.onclose = () => this.cleanupPeer(peerId);

    channel.onmessage = (ev) => {
      void this.onChannelMessage(peerId, channel, String(ev.data), () => sendAuth()).catch(() => {
        /* ignore per-message channel races */
      });
    };
  }

  private async onChannelMessage(
    peerId: string,
    channel: RTCDataChannel,
    text: string,
    ensureAuthSent: () => Promise<void>,
  ): Promise<void> {
    // Lightweight heartbeat bypass — bypass JSON.parse/auth path.
    if (text === GroupP2pMesh.DPE_PING) {
      if (channel.readyState === "open") {
        try {
          channel.send(GroupP2pMesh.DPE_PONG);
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (text === GroupP2pMesh.DPE_PONG) {
      this.notePeerAlive(peerId);
      return;
    }

    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return;
    }

    const authParse = authEnvelopeSchema.safeParse(json);
    if (authParse.success) {
      await ensureAuthSent();
      const peerPk = this.config.memberPublicKeys.get(peerId);
      if (!peerPk) {
        markRealtimeAuthError("peer_public_key_missing");
        channel.close();
        return;
      }
      try {
        const peer = await validateAuthEnvelopeWithPeerKey(authParse.data, {
          adminPublicKeyBase64Url: this.config.adminPublicKeyBase64Url,
          audience: this.config.groupId,
          peerPublicKeyBase64Url: peerPk,
        });
        this.onPeerAuthed(peer);
        this.notePeerAlive(peerId);
      } catch (e) {
        const detail = diagnoseJwtFailure(authParse.data.jwt, peerId, this.config.groupId);
        if (e instanceof AuthHandshakeError) {
          markRealtimeAuthError(`auth_verify_failed:${e.reason}${detail ? `:${detail}` : ""}`);
        } else {
          markRealtimeAuthError(`auth_verify_failed${detail ? `:${detail}` : ""}`);
        }
        channel.close();
      }
      return;
    }

    const kind = GroupP2pMesh.classifyWireMessage(text);
    const bytes = new TextEncoder().encode(text).byteLength;
    markRealtimeRx(bytes);
    this.notePeerAlive(peerId);
    const providerCount = this.providers.size;
    if (providerCount === 0) {
      traceRealtime(
        "provider",
        "wire_rx_no_provider",
        { peer: peerId.slice(0, 12), kind, bytes },
        "warn",
      );
    } else if (kind === "signed_update") {
      traceRealtime(
        "yjs",
        "wire_rx",
        { peer: peerId.slice(0, 12), kind, bytes, providerCount },
        "debug",
      );
    } else {
      traceRealtime("mesh", "wire_rx", { peer: peerId.slice(0, 12), kind, bytes, providerCount }, "debug");
    }
    for (const p of this.providers) {
      void p.handleWireMessage(text);
    }
  }
}
