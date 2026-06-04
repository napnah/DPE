import * as Y from "yjs";
import type { SignedUpdate } from "@dpe/proto";
import { createSignedUpdate } from "@dpe/crypto";
import { canMergeContentWrite } from "@dpe/acl";
import { ReplayCache } from "@dpe/crypto";
import type { DataChannelLike } from "@dpe/p2p";
import { decodeChannelMessage } from "@dpe/p2p";
import type { LocalDocSession, PeerSession } from "./session.js";
import { validateAndDecryptIncoming, MergeRejectedError } from "./merge-guard.js";
import { encodeSyncFrame, parseSyncFrame } from "./sync-frame.js";

export const DPE_PROVIDER_ORIGIN = Symbol("dpe-secure-yjs-provider");

export type SendFn = (text: string) => void | Promise<void>;

export interface SecureYjsProviderOptions {
  doc: Y.Doc;
  docId: string;
  local: LocalDocSession;
  /** Outbound wire (one peer or broadcast fan-out wrapper). */
  send: SendFn;
  onPeerRejected?: (nodeId: string, reason: string) => void;
  onError?: (err: unknown) => void;
}

/**
 * Yjs provider: local updates → SignedUpdate; inbound SignedUpdate → merge guard → Y.applyUpdate.
 */
export class SecureYjsProvider {
  readonly doc: Y.Doc;
  readonly docId: string;
  readonly local: LocalDocSession;

  private readonly send: SendFn;
  private readonly peers = new Map<string, PeerSession>();
  private readonly replay = new ReplayCache();
  private seq = 0;
  private destroyed = false;
  private readonly pending = new Set<Promise<unknown>>();
  private readonly onUpdate: (update: Uint8Array, origin: unknown) => void;
  private readonly onPeerRejected?: (nodeId: string, reason: string) => void;
  private readonly onError?: (err: unknown) => void;

  constructor(options: SecureYjsProviderOptions) {
    this.doc = options.doc;
    this.docId = options.docId;
    this.local = options.local;
    this.send = options.send;
    this.onPeerRejected = options.onPeerRejected;
    this.onError = options.onError;

    this.onUpdate = (update, origin) => {
      if (this.destroyed || origin === DPE_PROVIDER_ORIGIN) return;
      if (!canMergeContentWrite(this.local.role)) return;
      this.track(this.broadcastUpdate(update));
    };
    this.doc.on("update", this.onUpdate);
  }

  registerPeer(session: PeerSession): void {
    this.peers.set(session.nodeId, session);
  }

  /** Update local JWT-derived session without tearing down the Y.Doc (role/key changes). */
  updateLocalSession(patch: Partial<Pick<LocalDocSession, "role" | "docKey" | "keyVersion">>): void {
    if (patch.role !== undefined) this.local.role = patch.role;
    if (patch.docKey !== undefined) this.local.docKey = patch.docKey;
    if (patch.keyVersion !== undefined) this.local.keyVersion = patch.keyVersion;
  }

  unregisterPeer(nodeId: string): void {
    this.peers.delete(nodeId);
  }

  getPeerSessions(): ReadonlyMap<string, PeerSession> {
    return this.peers;
  }

  /** Attach to an authenticated DataChannel (post-AuthEnvelope). */
  bindChannel(channel: DataChannelLike): void {
    channel.onmessage = (raw) => {
      void this.handleWireMessage(decodeChannelMessage(raw));
    };
  }

  async handleWireMessage(text: string): Promise<void> {
    if (this.destroyed) return;
    try {
      const frame = parseSyncFrame(text);
      await this.track(this.receiveSignedUpdate(frame.update));
    } catch (e) {
      if (e instanceof MergeRejectedError) {
        this.onPeerRejected?.(
          (e as MergeRejectedError & { signer?: string }).signer ?? "unknown",
          e.reason,
        );
        return;
      }
      this.onError?.(e);
    }
  }

  async receiveSignedUpdate(update: SignedUpdate): Promise<boolean> {
    try {
      const plaintext = await validateAndDecryptIncoming(
        {
          local: this.local,
          peers: this.peers,
          replay: this.replay,
          docId: this.docId,
        },
        update,
      );
      Y.applyUpdate(this.doc, plaintext, DPE_PROVIDER_ORIGIN);
      return true;
    } catch (e) {
      if (e instanceof MergeRejectedError) {
        this.onPeerRejected?.(update.signer_node_id, e.reason);
        return false;
      }
      throw e;
    }
  }

  async broadcastUpdate(plaintext: Uint8Array): Promise<SignedUpdate | null> {
    if (!canMergeContentWrite(this.local.role)) return null;
    this.seq += 1;
    const signed = await createSignedUpdate({
      docId: this.docId,
      keyVersion: this.local.keyVersion,
      docKey: this.local.docKey,
      plaintext,
      signerPrivateKey: this.local.privateKey,
      signerNodeId: this.local.nodeId,
      seq: this.seq,
    });
    const outbound = this.send(encodeSyncFrame(signed));
    if (outbound instanceof Promise) await outbound;
    return signed;
  }

  /** Wait for in-flight encrypt/send operations (tests and graceful shutdown). */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending]);
    }
  }

  private track<T>(promise: Promise<T>): Promise<T> {
    this.pending.add(promise);
    return promise.finally(() => {
      this.pending.delete(promise);
    });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.doc.off("update", this.onUpdate);
    this.peers.clear();
    this.replay.clear();
  }
}
