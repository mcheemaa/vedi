import type { ClickHouse } from "./clickhouse";

/** One row per turn, silences included. This table is the agent's own
 * behavior made queryable: what it said, what it chose not to say, and
 * why, each anchored to the frames that justified it. The surface
 * ticker and the recall tool read the same rows (single substrate). */
export type TraceRow = {
  turn_id: string;
  kind: "percept" | "user" | "heartbeat";
  action: "speak" | "note" | "ignore" | "reply" | "skip" | "error";
  text: string;
  why: string;
  delivery: string;
  evidence: string[];
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
};

const DDL = `
CREATE TABLE IF NOT EXISTS vedi.traces
(
    ts DateTime64(3),
    turn_id UUID,
    kind LowCardinality(String),
    action LowCardinality(String),
    text String,
    why String,
    delivery String,
    evidence Array(UUID),
    model LowCardinality(String),
    latency_ms Float32,
    input_tokens UInt32,
    output_tokens UInt32
)
ENGINE = MergeTree
ORDER BY ts
`;

export class Traces {
  constructor(private readonly ch: ClickHouse) {}

  async ensureTable(): Promise<void> {
    await this.ch.command(DDL);
  }

  async write(row: TraceRow): Promise<void> {
    await this.ch.insert("vedi.traces", [
      {
        ts: clickhouseNow(),
        ...row,
        evidence: row.evidence.filter(isUuid),
      },
    ]);
  }
}

function clickhouseNow(): string {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/** The model sometimes anchors evidence with prose instead of ids; a
 * non-UUID would fail the whole insert, so it is dropped, not trusted. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
