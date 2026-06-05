import "./simplepeer.min.js";

type PeerSignal = Record<string, unknown>;

export type SimplePeerPeer = {
  readonly connected: boolean;
  readonly destroyed: boolean;
  signal(data: string | PeerSignal): void;
  send(data: string | ArrayBuffer | Uint8Array): void;
  destroy(error?: Error): void;
  on(event: "signal", listener: (data: PeerSignal) => void): SimplePeerPeer;
  on(event: "connect", listener: () => void): SimplePeerPeer;
  on(event: "data", listener: (data: unknown) => void): SimplePeerPeer;
  on(event: "close", listener: () => void): SimplePeerPeer;
  on(event: "error", listener: (err: unknown) => void): SimplePeerPeer;
};

export type SimplePeerOptions = {
  initiator?: boolean;
  trickle?: boolean;
  iceCompleteTimeout?: number;
  channelName?: string;
  channelConfig?: RTCDataChannelInit;
  config?: RTCConfiguration;
  objectMode?: boolean;
};

type SimplePeerConstructor = new (options: SimplePeerOptions) => SimplePeerPeer;

const SimplePeer = (globalThis as typeof globalThis & { SimplePeer: SimplePeerConstructor }).SimplePeer;
if (!SimplePeer) {
  throw new Error("simple-peer vendor failed to initialize");
}

export default SimplePeer;
