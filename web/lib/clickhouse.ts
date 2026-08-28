/** Server-side window onto the memory: the surface reads the same rows
 * the model reads (single-substrate law), never a parallel store. */
export async function chQuery<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const host = process.env.CLICKHOUSE_HOST;
  const port = process.env.CLICKHOUSE_PORT;
  const user = process.env.CLICKHOUSE_USER;
  const key = process.env.CLICKHOUSE_PASSWORD;
  if (!host || !port || !user || !key) throw new Error("clickhouse env missing");

  const url = `https://${host}:${port}/?query=${encodeURIComponent(`${sql} FORMAT JSONEachRow`)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "X-ClickHouse-User": user, "X-ClickHouse-Key": key },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`clickhouse ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
