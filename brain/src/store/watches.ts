import type { ClickHouse } from "./clickhouse";

/** Standing attention: phrases the agent was asked to look for, held
 * as vectors and checked against every new percept. The contract
 * (create, list, cancel, fire) is QueryRunner-shaped so the executor
 * can move into ClickHouse itself when the cloud reaches 26.7. */
const DDL = `
CREATE TABLE IF NOT EXISTS vedi.watches
(
    watch_id UUID,
    phrase String,
    embedding Array(Float32) CODEC(ZSTD(1)),
    threshold Float32,
    active UInt8,
    created_at DateTime64(3),
    last_fired DateTime64(3),
    updated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY watch_id
`;

export type Watch = {
  watch_id: string;
  phrase: string;
  threshold: number;
  active: number;
  created_at: string;
  last_fired: string;
};

export class Watches {
  constructor(private readonly ch: ClickHouse) {}

  async ensureTable(): Promise<void> {
    await this.ch.command(DDL);
  }

  // Category-level phrases score ~0.26 against matching frames
  // (templated CLIP, measured live); specific objects run higher.
  async create(phrase: string, embedding: number[], threshold = 0.26): Promise<string> {
    const id = crypto.randomUUID();
    const now = wire(new Date());
    await this.ch.insert("vedi.watches", [
      {
        watch_id: id,
        phrase,
        embedding,
        threshold,
        active: 1,
        created_at: now,
        last_fired: "1970-01-01 00:00:00.000",
        updated_at: now,
      },
    ]);
    return id;
  }

  async list(): Promise<Watch[]> {
    return this.ch.query<Watch>(`
      SELECT watch_id, phrase, threshold, active, created_at, last_fired
      FROM vedi.watches FINAL WHERE active = 1 ORDER BY created_at`);
  }

  async cancel(idOrPhrase: string): Promise<boolean> {
    const safe = idOrPhrase.replace(/['\\]/g, "");
    const rows = await this.ch.query<{ watch_id: string }>(`
      SELECT watch_id FROM vedi.watches FINAL
      WHERE active = 1 AND (toString(watch_id) = '${safe}' OR phrase ILIKE '%${safe}%')
      LIMIT 1`);
    if (rows.length === 0) return false;
    await this.mutate(rows[0].watch_id, { active: 0 });
    return true;
  }

  async markFired(id: string): Promise<void> {
    await this.mutate(id, { last_fired: wire(new Date()) });
  }

  /** Reinsert-with-newer-version; ReplacingMergeTree keeps the latest. */
  private async mutate(id: string, patch: Record<string, unknown>): Promise<void> {
    const rows = await this.ch.query<Record<string, unknown>>(`
      SELECT watch_id, phrase, embedding, threshold, active,
             toString(created_at) AS created_at, toString(last_fired) AS last_fired
      FROM vedi.watches FINAL WHERE watch_id = '${id}' LIMIT 1`);
    if (rows.length === 0) return;
    await this.ch.insert("vedi.watches", [
      { ...rows[0], ...patch, updated_at: wire(new Date()) },
    ]);
  }
}

function wire(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
