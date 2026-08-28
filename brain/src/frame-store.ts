import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export interface FrameMeta {
  frameId: string;
  ts: string;
  camera: string;
  width: number;
  height: number;
}

/** Single writer to vedi-pg. TLS is verify-full against the service's
 * pinned CA (a per-service private authority published by the console). */
export class FrameStore {
  private pool: pg.Pool;
  /** Write-through cache of the freshest frames: the reel, her-eyes
   * view, and look calls almost always want what was just stored, so
   * those reads never touch Postgres; history still does. */
  private readonly hot = new Map<string, { ts: string; jpeg: Buffer }>();
  private static readonly HOT_LIMIT = 100;

  constructor(url: string, caPath: string) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 4,
      ssl: {
        ca: readFileSync(caPath, "utf8"),
        rejectUnauthorized: true,
      },
    });
  }

  static fromEnv(env: Record<string, string>, envDir: string): FrameStore {
    const url = env.POSTGRES_URL;
    if (!url) throw new Error("missing environment value: POSTGRES_URL");
    return new FrameStore(url, join(envDir, "certs/vedi-pg-ca.pem"));
  }

  async store(meta: FrameMeta, jpeg: Buffer): Promise<void> {
    await this.pool.query(
      `INSERT INTO frames (frame_id, ts, camera, width, height, jpeg)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (frame_id) DO NOTHING`,
      [meta.frameId, meta.ts, meta.camera, meta.width, meta.height, jpeg],
    );
    this.hot.set(meta.frameId, { ts: meta.ts, jpeg });
    if (this.hot.size > FrameStore.HOT_LIMIT) {
      const oldest = this.hot.keys().next().value;
      if (oldest) this.hot.delete(oldest);
    }
  }

  async fetch(frameId: string): Promise<Buffer | null> {
    const cached = this.hot.get(frameId);
    if (cached) return cached.jpeg;
    const { rows } = await this.pool.query("SELECT jpeg FROM frames WHERE frame_id = $1", [frameId]);
    return rows[0]?.jpeg ?? null;
  }

  async lookup(frameId: string): Promise<{ ts: string; jpeg: Buffer } | null> {
    const cached = this.hot.get(frameId);
    if (cached) return cached;
    const { rows } = await this.pool.query(
      "SELECT to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS ts, jpeg FROM frames WHERE frame_id = $1",
      [frameId],
    );
    return rows[0] ?? null;
  }

  async newest(): Promise<{ frame_id: string; ts: string; jpeg: Buffer } | null> {
    const { rows } = await this.pool.query(
      "SELECT frame_id, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS ts, jpeg FROM frames ORDER BY ts DESC LIMIT 1",
    );
    return rows[0] ?? null;
  }

  async recent(limit: number): Promise<{ frame_id: string; ts: string }[]> {
    const { rows } = await this.pool.query(
      "SELECT frame_id, to_char(ts AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS') AS ts FROM frames ORDER BY ts DESC LIMIT $1",
      [Math.min(Math.max(limit, 1), 60)],
    );
    return rows;
  }

  async health(): Promise<string> {
    const { rows } = await this.pool.query("SELECT count(*)::int AS frames FROM frames");
    return `frames stored: ${rows[0].frames}`;
  }
}
