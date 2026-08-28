import type { ClickHouse } from "./clickhouse";

/** The user's day runs on their clock, not UTC; digest rows are keyed
 * by the local date so an evening session stays part of today. */
export function localDay(offsetDays = 0): string {
  const date = new Date(Date.now() + offsetDays * 86_400_000);
  return date.toLocaleDateString("en-CA", { timeZone: "America/Los_Angeles" });
}

/** The narrator's output: one story per day, rewritten whole on every
 * fold (replace, not append). The digest is the agent's own memory of
 * today; it rides in her ambient context. */
const DDL = `
CREATE TABLE IF NOT EXISTS vedi.digests
(
    day Date,
    narrative String,
    facts String,
    threads String,
    model LowCardinality(String),
    updated_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(updated_at)
ORDER BY day
`;

export type Digest = {
  day: string;
  narrative: string;
  facts: string;
  threads: string;
  updated_at: string;
};

export class Digests {
  constructor(private readonly ch: ClickHouse) {}

  async ensureTable(): Promise<void> {
    await this.ch.command(DDL);
  }

  async write(day: string, narrative: string, facts: string, threads: string, model: string): Promise<void> {
    await this.ch.insert("vedi.digests", [
      { day, narrative, facts, threads, model, updated_at: wire(new Date()) },
    ]);
  }

  async forDay(day: string): Promise<Digest | null> {
    const rows = await this.ch.query<Digest>(`
      SELECT toString(day) AS day, narrative, facts, threads, toString(updated_at) AS updated_at
      FROM vedi.digests FINAL WHERE day = '${day.replace(/[^0-9-]/g, "")}'`);
    return rows[0] ?? null;
  }

  /** The ambient block for the agent's context; empty when today has
   * no story yet. */
  async block(day: string): Promise<string> {
    const digest = await this.forDay(day);
    if (!digest || !digest.narrative) return "";
    const threads = digest.threads ? `\nopen threads: ${digest.threads}` : "";
    return `[today so far]\n${digest.narrative}${threads}`;
  }
}

function wire(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
