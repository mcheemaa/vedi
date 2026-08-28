import { chQuery } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** Vector search over everything the eyes ever kept: the query becomes
 * a vector in the Eye's own text tower (via the Brain's warm
 * co-process), then ClickHouse ranks every stored embedding by cosine,
 * live, while ingest continues. */
export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q")?.trim();
  if (!query) return Response.json({ results: [] });

  const embedRes = await fetch(
    `http://127.0.0.1:8484/embed?text=${encodeURIComponent(`a photo of ${query}`)}`,
    { cache: "no-store" },
  ).catch(() => null);
  if (!embedRes?.ok) return Response.json({ results: [], error: "embed unavailable" });
  const { embedding } = (await embedRes.json()) as { embedding: number[] };
  const vector = `[${embedding.map((value) => value.toFixed(6)).join(",")}]`;

  const results = await chQuery<{
    frame_id: string;
    ts: string;
    region_id: number;
    keyframe: number;
    sim: number;
    caption: string;
    nearest_frame: string;
  }>(`
    SELECT h.frame_id AS frame_id, h.ts AS ts, h.region_id AS region_id,
           h.keyframe AS keyframe, h.sim AS sim,
           coalesce(e.caption, '') AS caption,
           if(h.keyframe = 1, toString(h.frame_id), coalesce(toString(k.frame_id), '')) AS nearest_frame
    FROM (
      SELECT frame_id, ts, region_id, keyframe, 1 AS one,
             round(1 - cosineDistance(embedding, ${vector}), 3) AS sim
      FROM vedi.percepts
      ORDER BY sim DESC
      LIMIT 12
    ) h
    LEFT JOIN vedi.enrichments e ON e.frame_id = h.frame_id
    ASOF LEFT JOIN (
      SELECT frame_id, ts, 1 AS one FROM vedi.percepts WHERE keyframe = 1
    ) k ON k.one = h.one AND k.ts <= h.ts
    ORDER BY h.sim DESC`);

  return Response.json({ results });
}
