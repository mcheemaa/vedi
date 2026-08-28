import { chQuery } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** What was thought and said around a moment in time. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const ts = url.searchParams.get("ts")?.replace(/[^0-9 :.-]/g, "");
  const frameId = url.searchParams.get("frame_id")?.replace(/[^0-9a-f-]/gi, "");
  if (!ts) return Response.json({ thoughts: [], caption: "" });
  const [thoughts, caption, nearest] = await Promise.all([
    chQuery<{ ts: string; action: string; text: string; why: string }>(`
      SELECT ts, action, text, why FROM vedi.traces
      WHERE ts BETWEEN parseDateTime64BestEffort('${ts}') - INTERVAL 90 SECOND
                AND parseDateTime64BestEffort('${ts}') + INTERVAL 90 SECOND
      ORDER BY ts ASC LIMIT 12`),
    frameId
      ? chQuery<{ caption: string }>(
          `SELECT caption FROM vedi.enrichments WHERE frame_id = '${frameId}' LIMIT 1`,
        )
      : Promise.resolve([] as { caption: string }[]),
    chQuery<{ frame_id: string; gap: number }>(`
      SELECT frame_id,
             abs(toUnixTimestamp64Milli(ts) - toUnixTimestamp64Milli(parseDateTime64BestEffort('${ts}'))) / 1000 AS gap
      FROM vedi.percepts WHERE keyframe = 1
      ORDER BY gap ASC LIMIT 1`),
  ]);
  return Response.json({
    thoughts,
    caption: caption[0]?.caption ?? "",
    nearestFrame: nearest[0]?.frame_id ?? null,
    nearestGap: nearest[0] ? Math.round(nearest[0].gap) : null,
  });
}
