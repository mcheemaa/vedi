import { chQuery } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** One remembered moment becomes the query: its own embedding ranks
 * every other moment. The brain searching itself. */
export async function GET(request: Request) {
  const frameId = new URL(request.url).searchParams.get("frame_id")?.replace(/[^0-9a-f-]/gi, "");
  if (!frameId) return Response.json({ results: [] });
  const results = await chQuery<{
    frame_id: string;
    ts: string;
    region_id: number;
    keyframe: number;
    sim: number;
    caption: string;
  }>(`
    WITH (SELECT embedding FROM vedi.percepts WHERE frame_id = '${frameId}' LIMIT 1) AS query
    SELECT p.frame_id AS frame_id, p.ts AS ts, p.region_id AS region_id,
           p.keyframe AS keyframe,
           round(1 - cosineDistance(p.embedding, query), 3) AS sim,
           coalesce(e.caption, '') AS caption
    FROM vedi.percepts p
    LEFT JOIN vedi.enrichments e ON e.frame_id = p.frame_id
    WHERE p.frame_id != '${frameId}'
    ORDER BY sim DESC LIMIT 10`);
  return Response.json({ results });
}
