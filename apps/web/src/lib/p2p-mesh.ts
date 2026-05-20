import {
  serializeAuthEnvelope,
  validateAuthEnvelopeWithPeerKey,
  type AuthenticatedPeer,
} from "@dpe/p2p";
import type { AuthEnvelope } from "@dpe/proto";
import { authEnvelopeSchema } from "@dpe/proto";
import { SecureYjsProvider, type PeerSession } from "@dpe/yjs-provider";
import { base64UrlToBytes } from "@dpe/crypto";

const SIGNALING = import.meta.env.VITE_SIGNALING_URL ?? "ws://localhost:3002/ws";

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

  constructor(private readonly config: MeshConfig) {}

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
    for (const ch of this.channels.values()) {
      if (ch.readyState === "open") ch.send(text);
    }
  }

  async start(): Promise<void> {
    this.ws = new WebSocket(SIGNALING);
    await new Promise<void>((resolve, reject) => {
      const ws = this.ws!;
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("signaling connect failed"));
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
    for (const pc of this.pcs.values()) pc.close();
    this.pcs.clear();
    this.channels.clear();
    this.authenticated.clear();
    this.providers.clear();
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
      for (const peerId of msg.peers) {
        if (peerId === this.config.nodeId || this.pcs.has(peerId)) continue;
        void this.connectPeer(peerId, this.config.nodeId < peerId);
      }
      return;
    }

    if (msg.type !== "signal" || !msg.payload) return;
    const from = String(msg.payload.from ?? "");
    const pc = this.pcs.get(from);
    if (!pc) return;

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
      sentAuth = true;
      const jwt = await this.config.getJwt();
      const envelope: AuthEnvelope = {
        type: "auth",
        node_id: this.config.nodeId,
        jwt,
      };
      channel.send(serializeAuthEnvelope(envelope));
    };

    channel.onopen = () => void sendAuth();
    channel.onclose = () => this.channels.delete(peerId);

    channel.onmessage = (ev) => {
      void this.onChannelMessage(peerId, channel, String(ev.data), () => sendAuth());
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
      if (!peerPk) return;
      try {
        const peer = await validateAuthEnvelopeWithPeerKey(authParse.data, {
          adminPublicKeyBase64Url: this.config.adminPublicKeyBase64Url,
          audience: this.config.groupId,
          peerPublicKeyBase64Url: peerPk,
        });
        this.onPeerAuthed(peer);
      } catch {
        channel.close();
      }
      return;
    }

    for (const p of this.providers) {
      void p.handleWireMessage(text);
    }
  }
}
