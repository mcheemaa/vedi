import type { ClickHouse } from "./clickhouse";

/** Durable knowledge the agent chooses to keep: names first. One row
 * per (kind, key), newest note wins, injected into every turn so a
 * name told once holds forever. */
const DDL = `
CREATE TABLE IF NOT EXISTS vedi.facts
(
    kind LowCardinality(String),
    key String,
    value String,
    noted_at DateTime64(3)
)
ENGINE = ReplacingMergeTree(noted_at)
ORDER BY (kind, key)
`;

export class Facts {
  constructor(private readonly ch: ClickHouse) {}

  async ensureTable(): Promise<void> {
    await this.ch.command(DDL);
  }

  async note(kind: string, key: string, value: string): Promise<void> {
    await this.ch.insert("vedi.facts", [
      { kind, key, value, noted_at: wire(new Date()) },
    ]);
  }

  async block(): Promise<string> {
    const rows = await this.ch.query<{ kind: string; key: string; value: string }>(`
      SELECT kind, key, value FROM vedi.facts FINAL
      ORDER BY kind = 'person' DESC, noted_at DESC LIMIT 14`);
    if (rows.length === 0) return "";
    const lines = rows.map((row) => `${row.kind} · ${row.key}: ${row.value}`);
    return `[what I know]\n${lines.join("\n")}`;
  }
}

function wire(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}
