import { chQuery } from "@/lib/clickhouse";

export const dynamic = "force-dynamic";

/** One heartbeat of surface state: the literal context block from the
 * Brain, the region strip, and the thought stream, silences included. */
export async function GET() {
  const [mind, regions, thoughts, eye, spark, counters] = await Promise.all([
    fetch("http://127.0.0.1:8484/vision", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null),
    chQuery<{
      region_id: number;
      label: string;
      status: string;
      member_count: string;
      last_seen: string;
    }>(`
      SELECT region_id, label, status, toString(member_count) AS member_count, last_seen
      FROM vedi.regions FINAL ORDER BY last_seen DESC LIMIT 14`),
    chQuery<{
      ts: string;
      kind: string;
      action: string;
      text: string;
      why: string;
      delivery: string;
      evidence: string[];
      latency_ms: number;
    }>(`
      SELECT turn_id, ts, kind, action, text, why, delivery, evidence, latency_ms
      FROM vedi.traces WHERE action != 'skip'
      ORDER BY ts DESC LIMIT 40`),
    chQuery<{ kind: string; ts: string }>(`
      SELECT kind, ts FROM vedi.events
      WHERE kind IN ('eye_started', 'eye_stopped', 'camera_lost', 'camera_recovered')
      ORDER BY ts DESC LIMIT 1`),
    chQuery<{ minute: string; n: string }>(`
      SELECT toStartOfMinute(ts) AS minute, toString(count()) AS n
      FROM vedi.percepts WHERE ts > now() - INTERVAL 12 MINUTE
      GROUP BY minute ORDER BY minute`),
    chQuery<{ silences: string; keyframes: string }>(`
      SELECT
        (SELECT toString(count()) FROM vedi.traces WHERE action = 'ignore' AND ts > now() - INTERVAL 12 HOUR) AS silences,
        (SELECT toString(count()) FROM vedi.percepts WHERE keyframe = 1 AND ts > now() - INTERVAL 12 HOUR) AS keyframes`),
  ]);

  const eyeState = eye[0];
  const eyesOpen = eyeState?.kind === "eye_started" || eyeState?.kind === "camera_recovered";

  return Response.json({
    now: Date.now(),
    brainUp: mind !== null,
    eyesOpen,
    vision: mind?.vision ?? "",
    policy: mind?.policy ?? "",
    regions,
    thoughts,
    spark: spark.map((row) => Number(row.n)),
    silences: Number(counters[0]?.silences ?? 0),
    keyframes: Number(counters[0]?.keyframes ?? 0),
  });
}
