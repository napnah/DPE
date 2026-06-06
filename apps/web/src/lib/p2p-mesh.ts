import SimplePeer, { type SimplePeerPeer } from "../vendor/simplepeer";
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
import { resolveSignalingWebSocketUrl } from "./dev-tunnel.js";

type SimplePeerSignal = Record<string, unknown>;
type SimplePeerInstance = SimplePeerPeer;
type SimplePeerSignalInput = Exclude<Parameters<SimplePeerInstance["signal"]>[0], string>;
type SimplePeerInternals = SimplePeerInstance & { _pc?: RTCPeerConnection };

type PeerEntry = {
  peer: SimplePeerInstance;
  connected: boolean;
  authSending: boolean;
  answerTimer: ReturnType<typeof setTimeout> | null;
  connectionId: string;
};

function normalizeSignalingUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  return trimmed.endsWith("/ws") ? trimmed : `${trimmed}/ws`;
}

function defaultSignalingUrl(): string {
  return normalizeSignalingUrl(resolveSignalingWebSocketUrl());
}

function signalKind(signal: unknown): string {
  if (!signal || typeof signal !== "object") return "unknown";
  const data = signal as Record<string, unknown>;
  if (typeof data.type === "string") return data.type;
  if ("candidate" in data) return "candidate";
  if ("renegotiate" in data) return "renegotiate";
  if ("transceiverRequest" in data) return "transceiverRequest";
  return "unknown";
}

function decodePeerData(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (ArrayBuffer.isView(data)) {
    return new TextDecoder().decode(data);
  }
  return String(data);
}

function createConnectionId(nodeId: string, peerId: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${nodeId.slice(0, 8)}-${peerId.slice(0, 8)}-${Date.now().toString(36)}-${suffix}`;
}

function isLanP2pMode(): boolean {
  if (import.meta.env.VITE_P2P_LAN === "1") return true;
  if (typeof location === "undefined") return false;
  const host = location.hostname;
  return (
    host === "localhost" ||
    host === "127.0.0.1" ||
    /^192\.168\./.test(host) ||
    /^10\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host)
  );
}

function simplePeerRtcConfig(
  lanStunUrls: string[],
): { trickle: boolean; iceCompleteTimeout?: number; config: RTCConfiguration } {
  const lan = isLanP2pMode();
  if (!lan) {
    return { trickle: true, config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] } };
  }
  // LAN mode: keep trickle ENABLED. With trickle disabled, the offer/answer must carry a
  // final candidate set; Firefox (as responder) then declares ICE "failed" the instant it
  // sees no immediately-pairable candidate, without ever gathering its own srflx. With
  // trickle on, host + LAN-STUN srflx candidates (real IPs) flow incrementally over the
  // signaling channel and ICE keeps checking until a working pair is found.
  return {
    trickle: true,
    config: lanStunUrls.length ? { iceServers: [{ urls: lanStunUrls }] } : { iceServers: [] },
  };
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
  private readonly peers = new Map<string, PeerEntry>();
  private readonly providers = new Set<SecureYjsProvider>();
  private readonly authenticated = new Map<string, AuthenticatedPeer>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly lastAlive = new Map<string, number>();
  private readonly currentRoomPeers = new Set<string>();
  private readonly roomPeersBySignal = new Map<string, Set<string>>();
  private readonly seenSignalIds = new Set<string>();
  private signalSeq = 0;
  private lastPeersInRoom = 0;
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private readonly wsReconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly wsReconnectAttempts = new Map<string, number>();
  private readonly extraSignalingUrls = new Set<string>();
  private stopped = false;
  private static readonly HEALTH_INTERVAL_MS = 2_000;
  private static readonly WS_RECONNECT_MAX_MS = 30_000;
  private static readonly PONG_TIMEOUT_MS = 15_000;
  private static readonly DPE_PING = "__dpe_ping__";
  private static readonly DPE_PONG = "__dpe_pong__";
  private static readonly PENDING_WIRE_MAX = 64;
  private static readonly ANSWER_TIMEOUT_MS = 8_000;
  /** Delay before retrying WebRTC after a peer drop or failed handshake. */
  private static readonly PEER_RECONNECT_MS = 250;
  private readonly pendingWireMessages: Array<{ peerId: string; text: string }> = [];

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
    for (const url of this.extraSignalingUrls) urls.add(url);
    return [...urls];
  }

  /** STUN URLs for LAN mode, derived from the rendezvous (signaling) hosts, e.g. stun:192.168.18.1:3478. */
  private lanStunUrls(): string[] {
    const override = (import.meta.env.VITE_LAN_STUN_URLS as string | undefined)?.trim();
    if (override) {
      return override.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const port = (import.meta.env.VITE_LAN_STUN_PORT as string | undefined)?.trim() || "3478";
    const hosts = new Set<string>();
    for (const url of this.signalingUrls()) {
      try {
        const host = new URL(url).hostname;
        if (host && host !== "localhost" && host !== "127.0.0.1") hosts.add(host);
      } catch {
        /* ignore malformed url */
      }
    }
    return [...hosts].map((h) => `stun:${h}:${port}`);
  }

  /**
   * Add rendezvous URLs to a RUNNING mesh without restarting it. Discovery is
   * volatile, so the mesh must absorb new signaling endpoints live instead of being
   * torn down (which would kill in-flight WebRTC handshakes and open channels).
   */
  addSignalingUrls(urls: string[]): void {
    if (this.stopped) return;
    for (const raw of urls) {
      if (!raw?.trim()) continue;
      const url = normalizeSignalingUrl(raw);
      if (this.extraSignalingUrls.has(url)) continue;
      this.extraSignalingUrls.add(url);
      const existing = this.sockets.get(url);
      if (existing?.readyState === WebSocket.OPEN || existing?.readyState === WebSocket.CONNECTING) {
        continue;
      }
      void this.openSignalingSocket(url, false).catch(() => this.scheduleSignalingReconnect(url));
    }
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

  private tryConnectPeer(peerId: string, reason: string): void {
    if (peerId === this.config.nodeId) return;
    if (!this.currentRoomPeers.has(peerId)) return;
    if (!this.hasOpenSignaling()) return;
    if (this.hasOpenChannel(peerId) || this.hasPendingConnection(peerId)) return;
    if (!this.shouldInitiate(peerId)) return;
    traceRealtime("mesh", "try_connect", { peer: peerId.slice(0, 12), reason }, "debug");
    this.connectPeer(peerId, true);
  }

  /** Tear down stale peers on leave; reconnect immediately when a peer re-joins (page refresh). */
  private handleRoomPeerChanges(prevRoomPeers: Set<string>): void {
    const self = this.config.nodeId;
    for (const peerId of prevRoomPeers) {
      if (peerId === self) continue;
      if (!this.currentRoomPeers.has(peerId)) {
        traceRealtime("signal", "peer_left_room", { peer: peerId.slice(0, 12) }, "info");
        this.cleanupPeer(peerId);
      }
    }
    for (const peerId of this.currentRoomPeers) {
      if (peerId === self) continue;
      if (!prevRoomPeers.has(peerId)) {
        traceRealtime("signal", "peer_joined_room", { peer: peerId.slice(0, 12) }, "info");
        this.cleanupPeer(peerId);
        this.tryConnectPeer(peerId, "peer_rejoined");
      }
    }
  }

  private hasOpenChannel(peerId: string): boolean {
    return this.peers.get(peerId)?.connected === true;
  }

  private hasPendingConnection(peerId: string): boolean {
    const entry = this.peers.get(peerId);
    return Boolean(entry && !entry.peer.destroyed);
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

    for (const [peerId, entry] of this.peers) {
      if (peerId === this.config.nodeId) {
        this.cleanupPeer(peerId);
        continue;
      }
      if (!entry.connected) continue;

      try {
        entry.peer.send(GroupP2pMesh.DPE_PING);
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

    if (this.hasOpenSignaling()) {
      for (const peerId of this.currentRoomPeers) {
        if (peerId === this.config.nodeId) continue;
        this.tryConnectPeer(peerId, "health_check");
      }
    }

    this.emitPeerStats();
  }

  private emitPeerStats(peersInRoom?: number): void {
    if (typeof peersInRoom === "number") {
      this.lastPeersInRoom = Math.max(0, peersInRoom);
    }
    let channelsOpen = 0;
    for (const entry of this.peers.values()) {
      if (entry.connected) channelsOpen += 1;
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
    this.flushPendingWire();
  }

  private flushPendingWire(): void {
    if (this.providers.size === 0 || this.pendingWireMessages.length === 0) return;
    const batch = [...this.pendingWireMessages];
    this.pendingWireMessages.length = 0;
    traceRealtime("provider", "wire_rx_flush", { count: batch.length }, "info");
    for (const { peerId, text } of batch) {
      this.ensurePeerOnProviders(peerId);
      for (const p of this.providers) void p.handleWireMessage(text);
    }
  }

  /** Re-send AuthEnvelope on every open channel (e.g. after ACL/JWT role change). */
  async reauthAllChannels(): Promise<void> {
    const tasks: Promise<void>[] = [];
    for (const [peerId, entry] of this.peers) {
      if (!entry.connected) continue;
      tasks.push(this.sendAuthToPeer(peerId, entry, true));
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
    for (const [peerId, entry] of this.peers) {
      if (!entry.connected) continue;
      if (kind === "signed_update" && !this.authenticated.has(peerId)) continue;
      try {
        entry.peer.send(text);
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
    queueMicrotask(() => this.runHealthCheck());
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
    const delay = Math.min(1000 * 2 ** attempts, GroupP2pMesh.WS_RECONNECT_MAX_MS);
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
        fail(isInitial ? `无法连接信令服务，请运行 pnpm dev 或检查 ${url}` : `信令重连失败 (${url})`);
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
    for (const timer of this.wsReconnectTimers.values()) clearTimeout(timer);
    this.wsReconnectTimers.clear();
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.healthTimer = null;
    for (const socket of this.sockets.values()) socket.close();
    this.sockets.clear();
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();
    for (const entry of this.peers.values()) entry.peer.destroy();
    this.peers.clear();
    this.authenticated.clear();
    this.providers.clear();
    this.lastAlive.clear();
    this.currentRoomPeers.clear();
    this.roomPeersBySignal.clear();
    this.seenSignalIds.clear();
    this.pendingWireMessages.length = 0;
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
    const entry = this.peers.get(peerId);
    if (entry) {
      if (entry.answerTimer) {
        clearTimeout(entry.answerTimer);
        entry.answerTimer = null;
      }
      try {
        entry.peer.destroy();
      } catch {
        /* ignore */
      }
    }
    this.peers.delete(peerId);
    this.authenticated.delete(peerId);
    this.lastAlive.delete(peerId);
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
      const prevRoomPeers = new Set(this.currentRoomPeers);
      this.roomPeersBySignal.set(url, new Set(msg.peers));
      this.rebuildCurrentRoomPeers();
      this.handleRoomPeerChanges(prevRoomPeers);
      traceRealtime("signal", "room_peers", {
        url,
        count: msg.peers.length,
        peers: msg.peers.map((p) => p.slice(0, 8)),
      });
      this.emitPeerStats(Math.max(0, this.currentRoomPeers.size - 1));
      for (const peerId of this.currentRoomPeers) {
        if (peerId === this.config.nodeId) continue;
        this.tryConnectPeer(peerId, "room_peers");
      }
      return;
    }

    if (msg.type !== "signal" || !msg.payload) return;
    const from = String(msg.payload.from ?? "");
    if (!from || from === this.config.nodeId) return;
    const signalId = typeof msg.payload.signal_id === "string" ? msg.payload.signal_id : "";
    const connectionId = typeof msg.payload.connection_id === "string" ? msg.payload.connection_id : "";
    if (signalId) {
      const seenKey = `${from}:${connectionId}:${signalId}`;
      if (this.seenSignalIds.has(seenKey)) {
        traceRealtime("signal", "signal_rx_duplicate", {
          url,
          from: from.slice(0, 12),
          signalId,
          connectionId,
        }, "debug");
        return;
      }
      this.seenSignalIds.add(seenKey);
      if (this.seenSignalIds.size > 1000) {
        const keep = [...this.seenSignalIds].slice(-500);
        this.seenSignalIds.clear();
        for (const key of keep) this.seenSignalIds.add(key);
      }
    }
    const signal = msg.payload.signal as SimplePeerSignal | undefined;
    if (!signal) {
      traceRealtime("signal", "signal_ignored_missing_payload", { from: from.slice(0, 12) }, "warn");
      return;
    }

    traceRealtime("signal", "signal_rx", {
      url,
      from: from.slice(0, 12),
      kind: signalKind(signal),
      signalId,
      connectionId,
    }, "debug");

    const isOffer = signal.type === "offer";
    if (isOffer) {
      traceRealtime("signal", "offer_received", {
        url,
        from: from.slice(0, 12),
        hasPeer: this.peers.has(from),
      }, "info");
      if (this.shouldInitiate(from)) {
        traceRealtime("signal", "offer_ignored_role", { from: from.slice(0, 12) }, "warn");
        return;
      }
      const existing = this.peers.get(from);
      if (existing?.peer.destroyed) {
        this.cleanupPeer(from);
      } else if (existing && connectionId && existing.connectionId !== connectionId) {
        traceRealtime("signal", "offer_replaces_existing_peer", {
          from: from.slice(0, 12),
          previousConnectionId: existing.connectionId,
          connectionId,
        }, "warn");
        this.cleanupPeer(from);
      }
      if (!this.peers.has(from)) {
        this.connectPeer(from, false, connectionId || undefined);
        traceRealtime("signal", "responder_peer_created", { peer: from.slice(0, 12) }, "debug");
      }
    }

    const entry = this.peers.get(from);
    if (!entry) {
      traceRealtime("signal", "signal_ignored_no_peer", {
        from: from.slice(0, 12),
        kind: signalKind(signal),
        signalId,
        connectionId,
      }, "warn");
      return;
    }
    if (connectionId && connectionId !== entry.connectionId) {
      traceRealtime("signal", "signal_ignored_stale_connection", {
        from: from.slice(0, 12),
        kind: signalKind(signal),
        signalId,
        connectionId,
        currentConnectionId: entry.connectionId,
      }, "warn");
      return;
    }

    try {
      entry.peer.signal(signal as SimplePeerSignalInput);
      if (signalKind(signal) === "answer" && entry.answerTimer) {
        clearTimeout(entry.answerTimer);
        entry.answerTimer = null;
        traceRealtime("signal", "answer_timer_cleared", {
          from: from.slice(0, 12),
          signalId,
          connectionId: entry.connectionId,
        }, "debug");
      }
      traceRealtime("signal", "signal_apply_ok", {
        from: from.slice(0, 12),
        kind: signalKind(signal),
        signalId,
        connectionId: entry.connectionId,
      }, "debug");
    } catch (e) {
      traceRealtime("signal", "signal_apply_failed", {
        from: from.slice(0, 12),
        kind: signalKind(signal),
        signalId,
        connectionId: entry.connectionId,
        error: e instanceof Error ? e.message : String(e),
      }, "warn");
    }
  }

  private signalingSocketsForPeer(peerId: string): [string, WebSocket][] {
    const candidates: [string, WebSocket][] = [];
    for (const [url, socket] of this.sockets) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      const peers = this.roomPeersBySignal.get(url);
      if (peers?.has(peerId)) candidates.push([url, socket]);
    }
    candidates.sort(([a], [b]) => a.localeCompare(b));
    if (candidates.length > 0) return candidates;

    return [...this.sockets.entries()]
      .filter(([, socket]) => socket.readyState === WebSocket.OPEN)
      .sort(([a], [b]) => a.localeCompare(b));
  }

  private sendSignal(to: string, signal: SimplePeerSignal, connectionId: string): void {
    const signalId = `${this.config.nodeId.slice(0, 12)}-${++this.signalSeq}`;
    const message = JSON.stringify({
      type: "signal",
      room: this.config.groupId,
      to,
      payload: { signal, signal_id: signalId, connection_id: connectionId },
    });
    const selected = this.signalingSocketsForPeer(to);
    if (selected.length === 0) {
      traceRealtime("signal", "signal_send_failed_no_socket", {
        to: to.slice(0, 12),
        kind: signalKind(signal),
        signalId,
      }, "warn");
      return;
    }
    for (const [url, socket] of selected) {
      traceRealtime("signal", "signal_send", {
        url,
        to: to.slice(0, 12),
        kind: signalKind(signal),
        signalId,
        connectionId,
        fanout: selected.length,
      }, "debug");
      socket.send(message);
    }
    if (signalKind(signal) === "offer") this.armAnswerTimeout(to, signalId);
  }

  private connectPeer(peerId: string, initiator = this.shouldInitiate(peerId), connectionId?: string): void {
    if (peerId === this.config.nodeId) return;
    if (initiator && !this.shouldInitiate(peerId)) return;
    const existing = this.peers.get(peerId);
    if (existing && !existing.peer.destroyed) return;
    const nextConnectionId = connectionId ?? createConnectionId(this.config.nodeId, peerId);
    traceRealtime("mesh", "connect_peer", {
      peer: peerId.slice(0, 12),
      initiator,
      connectionId: nextConnectionId,
    }, "info");

    this.cleanupPeer(peerId);

    const rtc = simplePeerRtcConfig(this.lanStunUrls());
    traceRealtime(
      "mesh",
      "rtc_config",
      {
        peer: peerId.slice(0, 12),
        initiator,
        trickle: rtc.trickle,
        iceServers: (rtc.config.iceServers ?? []).flatMap((s) =>
          Array.isArray(s.urls) ? s.urls : [s.urls],
        ),
      },
      "info",
    );
    const peer = new SimplePeer({
      initiator,
      trickle: rtc.trickle,
      iceCompleteTimeout: rtc.iceCompleteTimeout,
      channelName: "dpe",
      channelConfig: { ordered: true },
      config: rtc.config,
      objectMode: true,
    });
    const entry: PeerEntry = {
      peer,
      connected: false,
      authSending: false,
      answerTimer: null,
      connectionId: nextConnectionId,
    };
    this.peers.set(peerId, entry);
    this.tracePeerConnectionState(peerId, entry, initiator);

    peer.on("signal", (signal: unknown) => {
      const current = this.peers.get(peerId);
      if (current !== entry) {
        traceRealtime("signal", "signal_send_ignored_stale_peer", {
          to: peerId.slice(0, 12),
          kind: signalKind(signal),
          connectionId: entry.connectionId,
        }, "debug");
        return;
      }
      if (entry.answerTimer && signalKind(signal) === "answer") {
        clearTimeout(entry.answerTimer);
        entry.answerTimer = null;
      }
      this.sendSignal(peerId, signal as SimplePeerSignal, entry.connectionId);
    });

    peer.on("connect", () => {
      const current = this.peers.get(peerId);
      if (current !== entry) return;
      entry.connected = true;
      traceRealtime("mesh", "channel_open", {
        peer: peerId.slice(0, 12),
        transport: "simple-peer",
        connectionId: entry.connectionId,
      }, "info");
      this.notePeerAlive(peerId);
      this.emitPeerStats();
      void this.sendAuthToPeer(peerId, entry, false);
    });

    peer.on("data", (data: unknown) => {
      void this.onPeerData(peerId, entry, decodePeerData(data)).catch(() => {
        /* ignore per-message channel races */
      });
    });

    peer.on("close", () => {
      const current = this.peers.get(peerId);
      if (current !== entry) return;
      traceRealtime("mesh", "peer_closed", { peer: peerId.slice(0, 12) }, "warn");
      this.cleanupPeer(peerId);
      if (!this.stopped && this.hasOpenSignaling() && this.currentRoomPeers.has(peerId) && this.shouldInitiate(peerId)) {
        this.schedulePeerReconnect(peerId);
      }
    });

    peer.on("error", (err: unknown) => {
      traceRealtime("mesh", "peer_error", {
        peer: peerId.slice(0, 12),
        error: err instanceof Error ? err.message : String(err),
        connectionId: entry.connectionId,
      }, "warn");
    });
  }

  private tracePeerConnectionState(peerId: string, entry: PeerEntry, initiator: boolean): void {
    const pc = (entry.peer as SimplePeerInternals)._pc;
    if (!pc) {
      traceRealtime("mesh", "pc_trace_unavailable", {
        peer: peerId.slice(0, 12),
        initiator,
        connectionId: entry.connectionId,
      }, "debug");
      return;
    }

    const traceState = (event: string) => {
      traceRealtime("mesh", event, {
        peer: peerId.slice(0, 12),
        initiator,
        connectionId: entry.connectionId,
        connectionState: pc.connectionState,
        iceConnectionState: pc.iceConnectionState,
        iceGatheringState: pc.iceGatheringState,
        signalingState: pc.signalingState,
      }, "debug");
    };

    traceState("pc_state_initial");
    pc.addEventListener("connectionstatechange", () => traceState("pc_connection_state"));
    pc.addEventListener("iceconnectionstatechange", () => traceState("pc_ice_state"));
    pc.addEventListener("icegatheringstatechange", () => traceState("pc_ice_gathering_state"));
    pc.addEventListener("signalingstatechange", () => traceState("pc_signaling_state"));
    pc.addEventListener("icecandidate", (e) => {
      const c = (e as RTCPeerConnectionIceEvent).candidate;
      if (!c) {
        traceRealtime("mesh", "ice_candidate_end", { peer: peerId.slice(0, 12) }, "debug");
        return;
      }
      traceRealtime(
        "mesh",
        "ice_candidate",
        { peer: peerId.slice(0, 12), type: c.type ?? null, protocol: c.protocol ?? null, address: c.address ?? null },
        "debug",
      );
    });
    pc.addEventListener("icecandidateerror", (e) => {
      const err = e as RTCPeerConnectionIceErrorEvent;
      traceRealtime(
        "mesh",
        "ice_candidate_error",
        { peer: peerId.slice(0, 12), url: err.url ?? null, errorCode: err.errorCode ?? null, errorText: err.errorText ?? null },
        "warn",
      );
    });
  }

  private armAnswerTimeout(peerId: string, signalId: string): void {
    const entry = this.peers.get(peerId);
    if (!entry || entry.connected) return;
    if (entry.answerTimer) clearTimeout(entry.answerTimer);
    entry.answerTimer = setTimeout(() => {
      const current = this.peers.get(peerId);
      if (!current || current.connected || current.peer.destroyed) return;
      traceRealtime("signal", "answer_timeout", {
        peer: peerId.slice(0, 12),
        signalId,
      }, "warn");
      this.cleanupPeer(peerId);
      if (!this.stopped && this.currentRoomPeers.has(peerId) && this.shouldInitiate(peerId)) {
        this.schedulePeerReconnect(peerId);
      }
    }, GroupP2pMesh.ANSWER_TIMEOUT_MS);
  }

  private schedulePeerReconnect(peerId: string): void {
    if (this.reconnectTimers.has(peerId)) return;
    const timer = setTimeout(() => {
      this.reconnectTimers.delete(peerId);
      if (this.stopped || !this.hasOpenSignaling() || !this.currentRoomPeers.has(peerId)) return;
      this.tryConnectPeer(peerId, "scheduled_reconnect");
    }, GroupP2pMesh.PEER_RECONNECT_MS);
    this.reconnectTimers.set(peerId, timer);
  }

  private async sendAuthToPeer(peerId: string, entry: PeerEntry, force = false): Promise<void> {
    if (!entry.connected || entry.authSending) return;
    entry.authSending = true;
    try {
      const jwt = await this.config.getJwt();
      if (!entry.connected || entry.peer.destroyed) {
        markRealtimeAuthError("auth_not_open_after_jwt");
        return;
      }

      const envelope: AuthEnvelope = {
        type: "auth",
        node_id: this.config.nodeId,
        jwt,
      };
      entry.peer.send(serializeAuthEnvelope(envelope));
      traceRealtime("auth", "auth_sent", { peer: peerId.slice(0, 12), force }, "debug");
    } catch {
      markRealtimeAuthError("auth_send_failed");
    } finally {
      entry.authSending = false;
    }
  }

  private async onPeerData(peerId: string, entry: PeerEntry, text: string): Promise<void> {
    if (text === GroupP2pMesh.DPE_PING) {
      if (entry.connected) {
        try {
          entry.peer.send(GroupP2pMesh.DPE_PONG);
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
      await this.sendAuthToPeer(peerId, entry, false);
      const peerPk = this.config.memberPublicKeys.get(peerId);
      if (!peerPk) {
        markRealtimeAuthError("peer_public_key_missing");
        this.cleanupPeer(peerId);
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
        this.cleanupPeer(peerId);
      }
      return;
    }

    const kind = GroupP2pMesh.classifyWireMessage(text);
    const bytes = new TextEncoder().encode(text).byteLength;
    markRealtimeRx(bytes);
    this.notePeerAlive(peerId);
    const providerCount = this.providers.size;
    if (providerCount === 0) {
      this.pendingWireMessages.push({ peerId, text });
      if (this.pendingWireMessages.length > GroupP2pMesh.PENDING_WIRE_MAX) {
        this.pendingWireMessages.splice(
          0,
          this.pendingWireMessages.length - GroupP2pMesh.PENDING_WIRE_MAX,
        );
      }
      traceRealtime(
        "provider",
        "wire_rx_buffered",
        { peer: peerId.slice(0, 12), kind, bytes, queued: this.pendingWireMessages.length },
        "warn",
      );
      return;
    }
    if (kind === "signed_update") {
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
