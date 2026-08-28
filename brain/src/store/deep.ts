import type { ClickHouse } from "./clickhouse";

/** The dreamer's output: one studied moment per kept frame. The row's
 * existence is the processed mark (anti-join discovery); Replacing by
 * dreamed_at absorbs any double-dream race. A frame whose pixels were
 * never stored gets an empty row (model 'missing') so the
 * chronological queue moves past it instead of starving. */
const DDL = `
CREATE TABLE IF NOT EXISTS vedi.deep
(
    frame_id UUID,
    ts DateTime64(3),
    description String,
    text_read String,
    people String,
    place String,
    notable String,
    model LowCardinality(String),
    dreamed_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(dreamed_at)
ORDER BY frame_id
`;

export type DeepRow = {
  frame_id: string;
  ts: string;
  description: string;
  text_read: string;
  people: string;
  place: string;
  notable: string;
  model: string;
};

export class Deep {
  constructor(private readonly ch: ClickHouse) {}

  async ensureTable(): Promise<void> {
    await this.ch.command(DDL);
  }

  async write(row: DeepRow): Promise<void> {
    await this.ch.insert("vedi.deep", [{ ...row, dreamed_at: wire(new Date()) }]);
  }

  /** Kept frames not yet studied: today's first (live memory must not
   * starve behind a backfill), chronological within each lane so every
   * dream can read the thread written by the ones before it. */
  async undreamt(limit: number): Promise<{ frame_id: string; ts: string }[]> {
    return this.ch.query(`
      SELECT p.frame_id AS frame_id, toString(p.ts) AS ts
      FROM vedi.percepts AS p
      LEFT ANTI JOIN vedi.deep AS d ON p.frame_id = d.frame_id
      WHERE p.keyframe = 1
      ORDER BY toDate(p.ts, 'America/Los_Angeles') = today() DESC, p.ts ASC
      LIMIT ${Math.min(Math.max(limit, 1), 20)}`);
  }

  /** The written thread: the last studied moments before a point in
   * time, oldest first, for coherence context. */
  async thread(beforeTs: string, count: number): Promise<{ ts: string; description: string; people: string }[]> {
    const rows = await this.ch.query<{ ts: string; description: string; people: string }>(`
      SELECT toString(d.ts) AS ts, d.description AS description, d.people AS people
      FROM vedi.deep AS d FINAL
      WHERE d.description != '' AND d.ts < parseDateTime64BestEffort('${beforeTs.replace(/[^0-9 :.-]/g, "")}')
      ORDER BY d.ts DESC LIMIT ${Math.min(Math.max(count, 1), 8)}`);
    return rows.reverse();
  }

  /** The most recent studied row before a point in time, for the
   * continuation gate and identity carry-forward. */
  async lastDreamt(beforeTs: string): Promise<{ frame_id: string; people: string; place: string } | null> {
    const rows = await this.ch.query<{ frame_id: string; people: string; place: string }>(`
      SELECT toString(d.frame_id) AS frame_id, d.people AS people, d.place AS place
      FROM vedi.deep AS d FINAL
      WHERE d.description != '' AND d.ts < parseDateTime64BestEffort('${beforeTs.replace(/[^0-9 :.-]/g, "")}')
      ORDER BY d.ts DESC LIMIT 1`);
    return rows[0] ?? null;
  }

  async counts(): Promise<{ dreamt: string; pending: string }> {
    const rows = await this.ch.query<{ dreamt: string; pending: string }>(`
      SELECT
        (SELECT toString(count()) FROM vedi.deep WHERE description != '') AS dreamt,
        (SELECT toString(count()) FROM vedi.percepts AS p
          LEFT ANTI JOIN vedi.deep AS d ON p.frame_id = d.frame_id
          WHERE p.keyframe = 1) AS pending`);
    return rows[0] ?? { dreamt: "0", pending: "0" };
  }
}

function wire(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
