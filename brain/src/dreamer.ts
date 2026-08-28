import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { FrameStore } from "./frame-store";
import type { Deep } from "./store/deep";
import type { Digests } from "./store/digests";
import { localDay } from "./store/digests";
import type { Facts } from "./store/facts";
import type { ClickHouse } from "./store/clickhouse";

const TICK_MS = 20_000;
const BATCH = 5;
const THREAD_LEN = 4;
/** Above this cosine similarity to the last studied frame, the moment
 * is a continuation: recorded without a model call (the cascade law:
 * never pay a model for what the vectors already prove unchanged).
 * Measured 2026-08-28 over 730 consecutive keyframe pairs: p50 0.88,
 * p75 0.937, p90 0.971; 0.95 skips only the true repeats. */
const SIM_CONTINUATION = 0.95;

/** All-required per OpenAI's strict structured-output rule; empty
 * strings mean "nothing". */
const dreamSchema = z.object({
  description: z.string(),
  text_read: z.string(),
  people: z.array(
    z.object({
      name: z.string(),
      appearance: z.string(),
      evidence: z.string(),
    }),
  ),
  place: z.string(),
  notable: z.string(),
});

/** The subconscious: studies kept frames a few at a time, ~20-40s
 * behind life, chronologically, and writes vedi.deep rows. Never
 * blocks the live loop; discovery is an anti-join so the deep row
 * itself is the processed mark. */
export function startDreamer(deps: {
  ch: ClickHouse;
  deep: Deep;
  digests: Digests;
  facts: Facts;
  frames: FrameStore;
  model: LanguageModel;
  modelId: string;
  system: string;
}): void {
  let running = false;

  const tick = async (): Promise<void> => {
    if (running) return;
    running = true;
    try {
      const pending = await deps.deep.undreamt(BATCH);
      for (const frame of pending) {
        await dream(deps, frame).catch((error) => {
          log(`dream failed for ${frame.frame_id.slice(0, 8)}: ${String(error).slice(0, 160)}`);
        });
      }
    } catch (error) {
      log(`tick failed: ${String(error).slice(0, 160)}`);
    } finally {
      running = false;
    }
  };

  setInterval(() => void tick(), TICK_MS);
  void tick();
  log(`dreaming on ${deps.modelId}, batch ${BATCH}, every ${TICK_MS / 1000}s`);
}

async function dream(
  deps: Parameters<typeof startDreamer>[0],
  frame: { frame_id: string; ts: string },
): Promise<void> {
  const started = Date.now();
  const kept = await deps.frames.lookup(frame.frame_id);
  if (!kept) {
    // Pixels never reached storage (pre-frame-store era, or a dropped
    // ship); an empty row moves the chronological queue past it.
    await deps.deep.write({
      frame_id: frame.frame_id,
      ts: frame.ts,
      description: "",
      text_read: "",
      people: "[]",
      place: "",
      notable: "",
      model: "missing",
    });
    return;
  }

  const prior = await deps.deep.lastDreamt(frame.ts);
  if (prior) {
    const sim = await similarity(deps.ch, frame.frame_id, prior.frame_id);
    if (sim !== null && sim >= SIM_CONTINUATION) {
      await deps.deep.write({
        frame_id: frame.frame_id,
        ts: frame.ts,
        description: "Essentially the same scene as the previous studied moment.",
        text_read: "",
        people: prior.people,
        place: prior.place,
        notable: "",
        model: "continuation",
      });
      log(`${frame.frame_id.slice(0, 8)} continuation (sim ${sim.toFixed(3)})`);
      return;
    }
  }

  const [thread, captions, known, digest] = await Promise.all([
    deps.deep.thread(frame.ts, THREAD_LEN),
    neighborCaptions(deps.ch, frame.ts),
    deps.facts.block(),
    deps.digests.block(localDay()),
  ]);

  const threadBlock =
    thread.length > 0
      ? thread.map((row) => `${row.ts}: ${row.description}${peopleNote(row.people)}`).join("\n")
      : "(this is the first studied moment of the thread)";
  const context = [
    known ? `[known people]\n${known}` : "",
    digest,
    `[the thread: moments before this one]\n${threadBlock}`,
    captions ? `[nearby quick captions]\n${captions}` : "",
    `[this moment]\ntime ${frame.ts}. Study the image and write the deep memory of this exact moment.`,
  ]
    .filter((part) => part !== "")
    .join("\n\n");

  const result = await generateObject({
    model: deps.model,
    schema: dreamSchema,
    system: deps.system,
    messages: [
      {
        role: "user",
        content: [
          { type: "file", mediaType: "image/jpeg", data: kept.jpeg },
          { type: "text", text: context },
        ],
      },
    ],
    providerOptions: { openai: { reasoningEffort: "low" } },
  });

  const dreamRow = result.object;
  await deps.deep.write({
    frame_id: frame.frame_id,
    ts: frame.ts,
    description: dreamRow.description,
    text_read: dreamRow.text_read,
    people: JSON.stringify(dreamRow.people),
    place: dreamRow.place,
    notable: dreamRow.notable,
    model: deps.modelId,
  });
  const age = Math.max(0, Math.round((Date.now() - Date.parse(`${frame.ts.replace(" ", "T")}Z`)) / 1000));
  log(`${frame.frame_id.slice(0, 8)} age ${age}s ${Date.now() - started}ms "${dreamRow.description.slice(0, 70)}"`);
}

async function similarity(ch: ClickHouse, frameA: string, frameB: string): Promise<number | null> {
  const safeA = frameA.replace(/[^0-9a-f-]/g, "");
  const safeB = frameB.replace(/[^0-9a-f-]/g, "");
  const rows = await ch.query<{ sim: number }>(`
    SELECT 1 - cosineDistance(a.embedding, b.embedding) AS sim
    FROM (SELECT embedding FROM vedi.percepts WHERE frame_id = '${safeA}' LIMIT 1) AS a,
         (SELECT embedding FROM vedi.percepts WHERE frame_id = '${safeB}' LIMIT 1) AS b`);
  return rows[0]?.sim ?? null;
}

async function neighborCaptions(ch: ClickHouse, ts: string): Promise<string> {
  const safe = ts.replace(/[^0-9 :.-]/g, "");
  const rows = await ch.query<{ ts: string; caption: string }>(`
    SELECT toString(e.ts) AS ts, e.caption AS caption FROM vedi.enrichments AS e
    WHERE e.caption != ''
      AND e.ts BETWEEN parseDateTime64BestEffort('${safe}') - INTERVAL 90 SECOND
                   AND parseDateTime64BestEffort('${safe}')
    ORDER BY e.ts DESC LIMIT 3`);
  return rows.map((row) => `${row.ts}: ${row.caption}`).join("\n");
}

function peopleNote(peopleJson: string): string {
  try {
    const people = JSON.parse(peopleJson) as { name: string }[];
    if (people.length === 0) return "";
    return ` (people: ${people.map((person) => person.name).join(", ")})`;
  } catch {
    return "";
  }
}

function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 23)} DREAM ${message}`);
}
