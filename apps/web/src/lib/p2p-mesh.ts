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

function normalizeSignalingUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
}

function defaultSignalingUrl(): string {
  const raw = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:3002/ws";
  return normalizeSignalingUrl(raw);
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
  signalingUrls?: string[];
  getJwt: () => Promise<string>;
};

export class GroupP2pMesh {
  private readonly sockets = new Map<string, WebSocket>();
  private readonly pcs = new Map<string, RTCPeerConnection>();
  private readonly channels = new Map<string, RTCDataChannel>();
  private readonly providers = new Set<SecureYjsProvider>();
  private readonly authenticated = new Map<string, AuthenticatedPeer>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly pendingCandidates = new Map<string, RTCIceCandidateInit[]>();
  private readonly connecting = new Set<string>();
  private readonly lastAlive = new Map<string, number>();
  private readonly currentRoomPeers = new Set<string>();
  private readonly roomPeersBySignal = new Map<string, Set<string>>();
  private lastPeersInRoom = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly wsReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly wsReconnectAttempts = new Map<string, number>();
  private stopped = false;
  private static readonly HEALTH_INTERVAL_MS = 5_000;
  private static readonly WS_RECONNECT_MAX_MS = 30_000;
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

  private signalingUrls(): string[] {
    const urls = new Set<string>([defaultSignalingUrl()]);
    for (const url of this.config.signalingUrls ?? []) {
      if (url.trim()) urls.add(normalizeSignalingUrl(url));
    }
    return [...urls];
  }

  private hasOpenSignaling(): boolean {
    for (const socket of this.sockets.values()) {
      if (socket.readyState === WebSocket.OPEN) return true;
    }
    return false;
  }

  private rebuildCurrentRoomPeers(): void {
    this.currentRoomPeers.clear();
    for (const peers of this.roomPeersBySignal.values()) {
      for (const peer of peers) this.currentRoomPeers.add(peer);
    }
  }

  /** Lower node_id always initiates the WebRTC offer for a pair. */
  private shouldInitiate(peerId: string): boolean {
    return this.config.nodeId < peerId;
  }

  /** A peer is usable only when its DataChannel is open (PC "connected" alone is not enough). */
  private hasOpenChannel(peerId: string): boolean {
    return this.channels.get(peerId)?.readyState === "open";
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
    if (this.hasOpenSignaling()) {
      for (const peerId of this.currentRoomPeers) {
        if (peerId === this.config.nodeId) continue;
        if (this.hasOpenChannel(peerId) || this.connecting.has(peerId)) continue;
        const pc = this.pcs.get(peerId);
        if (pc) this.cleanupPeer(peerId);
        if (this.shouldInitiate(peerId)) {
          void this.connectPeer(peerId);
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
    this.syncProvidersWithAuthenticated();
  }

  /** Re-send AuthEnvelope on every open channel (e.g. after ACL/JWT role change). */
  async reauthAllChannels(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [peerId, ch] of this.channels) {
      if (ch.readyState !== "open") continue;
      tasks.push(this.sendAuthToPeer(peerId, ch, true));
    }
    await Promise.all(tasks);
  }

  private syncProvidersWithAuthenticated(): void {
    for (const provider of this.providers) {
      for (const peer of this.authenticated.values()) {
        try {
          provider.registerPeer(this.toPeerSession(peer));
        } catch {
          /* pk map may lag */
        }
      }
    }
  }

  private ensurePeerOnProviders(peerId: string): void {
    const auth = this.authenticated.get(peerId);
    if (!auth) return;
    try {
      const session = this.toPeerSession(auth);
      for (const provider of this.providers) {
        if (!provider.getPeerSessions().has(peerId)) {
          provider.registerPeer(session);
        }
      }
    } catch {
      /* pk map may lag */
    }
  }

  detachProvider(provider: SecureYjsProvider): void {
    this.providers.delete(provider);
  }

  broadcast(text: string): void {
    const bytes = new TextEncoder().encode(text).byteLength;
    const kind = GroupP2pMesh.classifyWireMessage(text);
    let sent = 0;
    for (const [peerId, ch] of this.channels) {
      if (ch.readyState !== "open") continue;
      if (kind === "signed_update" && !this.authenticated.has(peerId)) continue;
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
    this.stopped = false;
    const results = await Promise.allSettled(
      this.signalingUrls().map((url) => this.openSignalingSocket(url, true)),
    );
    if (!results.some((r) => r.status === "fulfilled")) {
      const first = results[0];
      throw first?.status === "rejected" && first.reason instanceof Error
        ? first.reason
        : new Error("无法连接任何信令服务");
    }
    this.startHealthLoop();
  }

  private sendJoin(socket: WebSocket): void {
    socket.send(
      JSON.stringify({
        type: "join",
        room: this.config.groupId,
        node_id: this.config.nodeId,
      }),
    );
  }

  private scheduleSignalingReconnect(url: string): void {
    if (this.stopped || this.wsReconnectTimers.has(url)) return;
    const attempts = this.wsReconnectAttempts.get(url) ?? 0;
    const delay = Math.min(
      1000 * 2 ** attempts,
      GroupP2pMesh.WS_RECONNECT_MAX_MS,
    );
    this.wsReconnectAttempts.set(url, attempts + 1);
    traceRealtime("signal", "ws_reconnect_scheduled", { url, delayMs: delay }, "warn");
    const timer = setTimeout(() => {
      this.wsReconnectTimers.delete(url);
      if (this.stopped) return;
      void this.openSignalingSocket(url, false).catch(() => {
        this.scheduleSignalingReconnect(url);
      });
    }, delay);
    this.wsReconnectTimers.set(url, timer);
  }

  private async openSignalingSocket(url: string, isInitial: boolean): Promise<void> {
    const existing = this.sockets.get(url);
    if (existing?.readyState === WebSocket.OPEN || existing?.readyState === WebSocket.CONNECTING) {
      return;
    }
    const ws = new WebSocket(url);
    this.sockets.set(url, ws);

    await new Promise<void>((resolve, reject) => {
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
        this.wsReconnectAttempts.set(url, 0);
        traceRealtime("signal", "ws_open", { url, initial: isInitial }, "info");
        ok();
      };
      ws.onerror = () => {
        window.clearTimeout(timeout);
        if (isInitial) {
          fail(`无法连接信令服务，请运行 pnpm dev 或检查 ${url}`);
        } else {
          fail(`信令重连失败 (${url})`);
        }
      };
      ws.onclose = () => {
        window.clearTimeout(timeout);
        if (!settled) {
          fail(isInitial ? `信令连接已关闭 (${url})` : `信令重连已关闭 (${url})`);
        }
      };
    });

    ws.onmessage = (ev) => void this.onSignalMessage(String(ev.data), url);
    ws.onclose = () => {
      traceRealtime("signal", "ws_closed", { url }, "warn");
      if (this.sockets.get(url) === ws) this.sockets.delete(url);
      this.roomPeersBySignal.delete(url);
      this.rebuildCurrentRoomPeers();
      if (!this.stopped) this.scheduleSignalingReconnect(url);
    };
    ws.onerror = () => {
      traceRealtime("signal", "ws_error", { url }, "warn");
    };

    this.sendJoin(ws);
  }

  stop(): void {
    this.stopped = true;
    for (const timer of this.wsReconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.wsReconnectTimers.clear();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
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
    this.roomPeersBySignal.clear();
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
    traceRealtime("auth", "peer_authed", {
      peer: peer.nodeId.slice(0, 12),
      role: peer.payload.role,
      docId: peer.payload.doc_id,
      reauth: this.authenticated.has(peer.nodeId),
    });
    this.authenticated.set(peer.nodeId, peer);
    try {
      this.syncProvidersWithAuthenticated();
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

  private async onSignalMessage(raw: string, url: string): Promise<void> {
    const msg = JSON.parse(raw) as {
      type: string;
      peers?: string[];
      payload?: Record<string, unknown>;
    };

    if (msg.type === "peers" && msg.peers) {
      this.roomPeersBySignal.set(url, new Set(msg.peers));
      this.rebuildCurrentRoomPeers();
      traceRealtime("signal", "room_peers", {
        url,
        count: msg.peers.length,
        peers: msg.peers.map((p) => p.slice(0, 8)),
      });
      this.emitPeerStats(Math.max(0, this.currentRoomPeers.size - 1));
      for (const peerId of this.currentRoomPeers) {
        if (peerId === this.config.nodeId) continue;
        if (this.hasOpenChannel(peerId) || this.connecting.has(peerId)) continue;
        if (this.pcs.has(peerId)) this.cleanupPeer(peerId);
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
      if (this.hasOpenChannel(from)) return;

      let pc = this.pcs.get(from);
      if (pc) {
        this.cleanupPeer(from);
        pc = undefined;
      }
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
    const message = JSON.stringify({
      type: "signal",
      room: this.config.groupId,
      to,
      payload,
    });
    for (const socket of this.sockets.values()) {
      if (socket.readyState === WebSocket.OPEN) socket.send(message);
    }
  }

  private async connectPeer(peerId: string, initiator = this.shouldInitiate(peerId)): Promise<void> {
    if (peerId === this.config.nodeId) return;
    if (initiator !== this.shouldInitiate(peerId)) return;
    if (this.connecting.has(peerId)) return;
    traceRealtime("mesh", "connect_peer", { peer: peerId.slice(0, 12), initiator }, "info");

    const existing = this.pcs.get(peerId);
    const existingChannel = this.channels.get(peerId);
    if (this.hasOpenChannel(peerId)) return;
    if (
      existingChannel?.readyState === "connecting" &&
      (existing?.connectionState === "connected" || existing?.connectionState === "connecting")
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
          if (this.hasOpenSignaling() && this.shouldInitiate(peerId)) {
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
            if (this.hasOpenSignaling() && this.shouldInitiate(peerId)) {
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

  private async sendAuthToPeer(
    peerId: string,
    channel: RTCDataChannel,
    force = false,
  ): Promise<void> {
    if (channel.readyState !== "open") {
      markRealtimeAuthError("auth_not_open_before_jwt");
      return;
    }

    const jwt = await this.config.getJwt();
    if (channel.readyState !== "open") {
      markRealtimeAuthError("auth_not_open_after_jwt");
      await new Promise((r) => setTimeout(r, 150));
      if (channel.readyState !== "open") return;
    }

    const envelope: AuthEnvelope = {
      type: "auth",
      node_id: this.config.nodeId,
      jwt,
    };
    try {
      channel.send(serializeAuthEnvelope(envelope));
      traceRealtime("auth", "auth_sent", { peer: peerId.slice(0, 12), force }, "debug");
    } catch {
      markRealtimeAuthError("auth_send_failed");
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

    const sendAuth = () => this.sendAuthToPeer(peerId, channel, false);

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
    this.ensurePeerOnProviders(peerId);
    for (const p of this.providers) {
      void p.handleWireMessage(text);
    }
  }
}
