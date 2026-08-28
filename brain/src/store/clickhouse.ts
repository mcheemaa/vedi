import { require_ } from "../env";

/** The Brain's window onto the memory. Queries are synchronous reads
 * over HTTPS; inserts ride server-side async batching like the Eye's. */
export class ClickHouse {
  private readonly base: string;
  private readonly headers: Record<string, string>;

  constructor(env: Record<string, string>) {
    const host = require_(env, "CLICKHOUSE_HOST");
    const port = require_(env, "CLICKHOUSE_PORT");
    this.base = `https://${host}:${port}/`;
    this.headers = {
      "X-ClickHouse-User": require_(env, "CLICKHOUSE_USER"),
      "X-ClickHouse-Key": require_(env, "CLICKHOUSE_PASSWORD"),
    };
  }

  async query<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const url = `${this.base}?query=${encodeURIComponent(`${sql} FORMAT JSONEachRow`)}`;
    const res = await fetch(url, { method: "POST", headers: this.headers });
    if (!res.ok) throw new Error(`clickhouse query ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const text = await res.text();
    return text
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as T);
  }

  async command(sql: string): Promise<void> {
    const url = `${this.base}?query=${encodeURIComponent(sql)}`;
    const res = await fetch(url, { method: "POST", headers: this.headers });
    if (!res.ok) throw new Error(`clickhouse command ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  async insert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0) return;
    const params = new URLSearchParams({
      query: `INSERT INTO ${table} FORMAT JSONEachRow`,
      async_insert: "1",
      wait_for_async_insert: "0",
    });
    const body = rows.map((row) => JSON.stringify(row)).join("\n");
    const res = await fetch(`${this.base}?${params}`, {
      method: "POST",
      headers: { ...this.headers, "Content-Type": "application/x-ndjson" },
      body,
    });
    if (!res.ok) throw new Error(`clickhouse insert ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
}
