import type { ClickHouse } from "../store/clickhouse";

/** The compact block that carries sight into every turn. Recomputed
 * fresh from ClickHouse each time and never stored: the database
 * remembers so the context does not have to. */
export async function buildVisionState(ch: ClickHouse): Promise<string> {
  const [latest, caption, events, regions, lifecycle, today] = await Promise.all([
    ch.query<{ ts: string; scene_id: number; region_id: number; region_sim: number; label: string }>(`
      SELECT p.ts AS ts, p.scene_id AS scene_id, p.region_id AS region_id,
             p.region_sim AS region_sim, r.label AS label
      FROM vedi.percepts p
      LEFT JOIN (SELECT region_id, label FROM vedi.regions FINAL) r ON r.region_id = p.region_id
      ORDER BY p.ts DESC LIMIT 1`),
    ch.query<{ ts: string; caption: string; face_count: number; head_forward: number; ocr_text: string }>(`
      SELECT ts, caption, face_count, head_forward, ocr_text
      FROM vedi.enrichments WHERE caption != '' ORDER BY ts DESC LIMIT 1`),
    ch.query<{ ts: string; kind: string; detail: string }>(`
      SELECT ts, kind, detail FROM vedi.events
      WHERE kind NOT IN ('region_switch')
      ORDER BY ts DESC LIMIT 8`),
    ch.query<{ label: string; sightings: string }>(`
      SELECT r.label AS label, toString(count()) AS sightings
      FROM vedi.percepts p
      INNER JOIN (SELECT region_id, label FROM vedi.regions FINAL WHERE label != '') r
        ON r.region_id = p.region_id
      WHERE p.ts > now() - INTERVAL 12 HOUR
      GROUP BY r.label ORDER BY count() DESC LIMIT 6`),
    ch.query<{ ts: string; kind: string }>(`
      SELECT ts, kind FROM vedi.events
      WHERE kind IN ('eye_started', 'eye_stopped', 'camera_lost', 'camera_recovered')
      ORDER BY ts DESC LIMIT 1`),
    ch.query<{ percepts: string; keyframes: string }>(`
      SELECT toString(count()) AS percepts, toString(countIf(keyframe = 1)) AS keyframes
      FROM vedi.percepts WHERE ts > now() - INTERVAL 12 HOUR`),
  ]);

  const lines: string[] = ["[what I see]"];

  const eye = lifecycle[0];
  if (!eye || eye.kind === "eye_stopped" || eye.kind === "camera_lost") {
    lines.push(`EYES CLOSED since ${eye ? ago(eye.ts) : "before memory"}: I cannot see right now.`);
  } else {
    lines.push(`eyes open (since ${ago(eye.ts)})`);
  }

  const now = latest[0];
  if (now) {
    const where = now.label ? `"${now.label}"` : `region ${now.region_id} (unnamed)`;
    lines.push(`current look: ${where}, familiarity ${Number(now.region_sim).toFixed(2)}, scene ${now.scene_id}, last frame ${ago(now.ts)}`);
  }

  const cap = caption[0];
  if (cap) {
    lines.push(`last described (${ago(cap.ts)}): ${cap.caption}`);
    lines.push(`faces: ${cap.face_count}, lean: ${Number(cap.head_forward).toFixed(2)}${cap.ocr_text ? `, text in view: "${truncate(cap.ocr_text, 80)}"` : ""}`);
  }

  if (regions.length > 0) {
    lines.push(`places/looks I know today: ${regions.map((r) => `${r.label} (${r.sightings})`).join(", ")}`);
  }

  if (events.length > 0) {
    lines.push("[recent moments]");
    for (const event of events.reverse()) {
      lines.push(`${ago(event.ts)}: ${event.kind} ${truncate(event.detail, 70)}`);
    }
  }

  const t = today[0];
  if (t) lines.push(`today: ${t.percepts} percepts, ${t.keyframes} keyframes remembered`);

  return lines.join("\n");
}

function ago(clickhouseTs: string): string {
  const seconds = Math.max(0, (Date.now() - Date.parse(`${clickhouseTs.replace(" ", "T")}Z`)) / 1000);
  if (seconds < 90) return `${Math.round(seconds)}s ago`;
  if (seconds < 5400) return `${Math.round(seconds / 60)}m ago`;
  return `${(seconds / 3600).toFixed(1)}h ago`;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
