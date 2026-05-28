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

  constructor(private readonly config: MeshConfig) {}

  private emitPeerStats(peersInRoom = 0): void {
    let channelsOpen = 0;
    for (const ch of this.channels.values()) {
      if (ch.readyState === "open") channelsOpen += 1;
    }
    markRealtimePeerStats({
      peersInRoom: Math.max(0, peersInRoom),
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
    for (const ch of this.channels.values()) {
      if (ch.readyState !== "open") continue;
      try {
        ch.send(text);
        markRealtimeTx(bytes);
      } catch {
        markRealtimeAuthError("broadcast_send_failed");
      }
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
  }

  stop(): void {
    this.ws?.close();
    for (const t of this.reconnectTimers.values()) clearTimeout(t);
    this.reconnectTimers.clear();
    for (const pc of this.pcs.values()) pc.close();
    this.pcs.clear();
    this.channels.clear();
    this.authenticated.clear();
    this.providers.clear();
    this.emitPeerStats(0);
  }

  private cleanupPeer(peerId: string): void {
    const timer = this.reconnectTimers.get(peerId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(peerId);
    }
    const pc = this.pcs.get(peerId);
    if (pc) {
      try {
        pc.close();
      } catch {
        /* ignore */
      }
    }
    this.pcs.delete(peerId);
    this.channels.delete(peerId);
    this.authenticated.delete(peerId);
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
    this.authenticated.set(peer.nodeId, peer);
    try {
      const session = this.toPeerSession(peer);
      for (const p of this.providers) p.registerPeer(session);
      this.emitPeerStats();
    } catch {
      /* retry when members loaded */
    }
  }

  private async onSignalMessage(raw: string): Promise<void> {
    const msg = JSON.parse(raw) as {
      type: string;
      peers?: string[];
      payload?: Record<string, unknown>;
    };

    if (msg.type === "peers" && msg.peers) {
      this.emitPeerStats(Math.max(0, msg.peers.length - 1));
      for (const peerId of msg.peers) {
        if (peerId === this.config.nodeId || this.pcs.has(peerId)) continue;
        void this.connectPeer(peerId, this.config.nodeId < peerId);
      }
      return;
    }

    if (msg.type !== "signal" || !msg.payload) return;
    const from = String(msg.payload.from ?? "");
    let pc = this.pcs.get(from);
    if (!pc) {
      // Signal ordering can race: offer may arrive before peers-list driven connectPeer().
      if (msg.payload.kind !== "offer") return;
      await this.connectPeer(from, false);
      pc = this.pcs.get(from);
      if (!pc) return;
    }

    if (msg.payload.kind === "offer" && msg.payload.sdp) {
      await pc.setRemoteDescription(
        new RTCSessionDescription(msg.payload.sdp as RTCSessionDescriptionInit),
      );
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal(from, { kind: "answer", sdp: answer });
    } else if (msg.payload.kind === "answer" && msg.payload.sdp) {
      await pc.setRemoteDescription(
        new RTCSessionDescription(msg.payload.sdp as RTCSessionDescriptionInit),
      );
    } else if (msg.payload.kind === "candidate" && msg.payload.candidate) {
      try {
        await pc.addIceCandidate(
          new RTCIceCandidate(msg.payload.candidate as RTCIceCandidateInit),
        );
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

  private async connectPeer(peerId: string, initiator: boolean): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.pcs.set(peerId, pc);
    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
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
        // Signal servers may not always emit another peers list update; try one reconnect.
        if (this.ws?.readyState === WebSocket.OPEN) {
          void this.connectPeer(peerId, this.config.nodeId < peerId);
        }
        return;
      }

      if (st === "disconnected") {
        // "disconnected" can be transient on unstable LAN/VM links; don't tear down immediately.
        if (this.reconnectTimers.has(peerId)) return;
        const timer = setTimeout(() => {
          this.reconnectTimers.delete(peerId);
          const current = this.pcs.get(peerId);
          if (!current || current.connectionState !== "disconnected") return;
          this.cleanupPeer(peerId);
          if (this.ws?.readyState === WebSocket.OPEN) {
            void this.connectPeer(peerId, this.config.nodeId < peerId);
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

    pc.ondatachannel = (ev) => this.wireChannel(peerId, ev.channel);

    if (initiator) {
      const channel = pc.createDataChannel("dpe");
      this.wireChannel(peerId, channel);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal(peerId, { kind: "offer", sdp: offer });
    }
  }

  private wireChannel(peerId: string, channel: RTCDataChannel): void {
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
        // Channel may race from open -> closing; let later events retry safely.
        markRealtimeAuthError("auth_send_failed");
      }
    };

    channel.onopen = () => {
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

    markRealtimeRx(new TextEncoder().encode(text).byteLength);
    for (const p of this.providers) {
      void p.handleWireMessage(text);
    }
  }
}
