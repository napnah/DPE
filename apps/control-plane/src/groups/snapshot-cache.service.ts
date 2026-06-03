import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient, type RedisClientType } from "redis";

type SnapshotCacheValue = {
  state_update_base64: string;
  key_version: number;
  updated_at: string;
  updated_by_node_id: string;
};

@Injectable()
export class SnapshotCacheService implements OnModuleDestroy {
  private client: RedisClientType | null = null;
  private enabled = false;

  constructor() {
    const redisUrl = (process.env.DPE_REDIS_URL ?? "").trim();
    if (!redisUrl) return;
    this.client = createClient({ url: redisUrl });
    this.client.on("error", () => {
      /* best effort cache */
    });
    void this.client.connect().then(() => {
      this.enabled = true;
    }).catch(() => {
      this.enabled = false;
      this.client = null;
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      /* ignore */
    }
  }

  private key(groupId: string, docId: string): string {
    return `dpe:doc:snapshot:${groupId}:${docId}`;
  }

  async get(groupId: string, docId: string): Promise<SnapshotCacheValue | null> {
    if (!this.enabled || !this.client) return null;
    const raw = await this.client.get(this.key(groupId, docId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as SnapshotCacheValue;
    } catch {
      return null;
    }
  }

  async set(groupId: string, docId: string, value: SnapshotCacheValue): Promise<void> {
    if (!this.enabled || !this.client) return;
    await this.client.set(this.key(groupId, docId), JSON.stringify(value), { EX: 60 * 10 });
  }

  async del(groupId: string, docId: string): Promise<void> {
    if (!this.enabled || !this.client) return;
    await this.client.del(this.key(groupId, docId));
  }
}
