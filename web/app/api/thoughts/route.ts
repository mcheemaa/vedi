import { chQuery } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** The full transcript, paginated upward: everything the agent ever
 * did, scrollable all the way back. */
export async function GET(request: Request) {
  const before = new URL(request.url).searchParams.get("before");
  const cursor = before ? `AND ts < parseDateTime64BestEffort('${before.replace(/[^0-9 :.-]/g, "")}')` : "";
  const rows = await chQuery<{
    turn_id: string;
    ts: string;
    kind: string;
    action: string;
    text: string;
    why: string;
    delivery: string;
    evidence: string[];
    latency_ms: number;
    input_tokens: number;
    output_tokens: number;
    model: string;
  }>(`
    SELECT turn_id, ts, kind, action, text, why, delivery, evidence, latency_ms,
           input_tokens, output_tokens, model
    FROM vedi.traces
    WHERE action != 'skip' ${cursor}
    ORDER BY ts DESC LIMIT 80`);
  return Response.json({ thoughts: rows.reverse() });
}
