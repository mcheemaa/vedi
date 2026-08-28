import { generateObject } from "ai";
import { z } from "zod";
import type { LanguageModel } from "ai";
import type { ClickHouse } from "./store/clickhouse";
import type { Digests } from "./store/digests";
import { localDay } from "./store/digests";
import type { Facts } from "./store/facts";

const FOLD_MS = 15 * 60_000;
const STALE_MS = 5 * 60_000;

/** All-required per OpenAI's strict structured-output rule. */
const digestSchema = z.object({
  narrative: z.string(),
  facts: z.string(),
  threads: z.string(),
});

export class Narrator {
  private folding = false;

  constructor(
    private readonly deps: {
      ch: ClickHouse;
      digests: Digests;
      facts: Facts;
      model: LanguageModel;
      modelId: string;
      system: string;
    },
  ) {}

  start(): void {
    setInterval(() => void this.foldIfStale(FOLD_MS), 60_000);
    void this.foldIfStale(FOLD_MS);
    log(`folding on ${this.deps.modelId}, every ${FOLD_MS / 60_000}m`);
  }

  /** Called fire-and-forget at the start of user turns: the current
   * turn uses the digest as-is, the next one benefits. */
  async foldIfStale(maxAgeMs = STALE_MS): Promise<void> {
    const day = localDay();
    const current = await this.deps.digests.forDay(day);
    const age = current ? Date.now() - Date.parse(`${current.updated_at.replace(" ", "T")}Z`) : Infinity;
    if (age < maxAgeMs) return;
    await this.fold(day);
  }

  async fold(day: string): Promise<void> {
    if (this.folding) return;
    this.folding = true;
    const started = Date.now();
    try {
      const safeDay = day.replace(/[^0-9-]/g, "");
      const [studied, spoken, yesterday, known] = await Promise.all([
        this.deps.ch.query<{ ts: string; description: string; people: string; place: string; notable: string }>(`
          SELECT toString(d.ts, 'America/Los_Angeles') AS ts, d.description AS description, d.people AS people,
                 d.place AS place, d.notable AS notable
          FROM vedi.deep AS d FINAL
          WHERE toDate(d.ts, 'America/Los_Angeles') = '${safeDay}'
            AND d.description != '' AND d.model != 'continuation'
          ORDER BY d.ts ASC LIMIT 250`),
        this.deps.ch.query<{ ts: string; kind: string; text: string; why: string }>(`
          SELECT toString(t.ts, 'America/Los_Angeles') AS ts, t.kind AS kind, t.text AS text, t.why AS why
          FROM vedi.traces AS t
          WHERE toDate(t.ts, 'America/Los_Angeles') = '${safeDay}' AND t.text != ''
          ORDER BY t.ts ASC LIMIT 80`),
        this.deps.digests.forDay(previousDay(day)),
        this.deps.facts.block(),
      ]);
      if (studied.length === 0 && spoken.length === 0) return;

      const material = [
        known,
        yesterday?.narrative ? `[yesterday, for continuity]\n${yesterday.narrative}` : "",
        `[what the eyes studied on ${day}]\n${studied
          .map((row) => `${row.ts.slice(11, 16)} ${row.description}${row.notable ? ` Notable: ${row.notable}` : ""}${peopleNote(row.people)}`)
          .join("\n")}`,
        spoken.length > 0
          ? `[what was said on ${day}]\n${spoken.map((row) => `${row.ts.slice(11, 16)} [${row.kind}] "${row.text}"`).join("\n")}`
          : "",
        `Fold this into the day's digest.`,
      ]
        .filter((part) => part !== "")
        .join("\n\n");

      const result = await generateObject({
        model: this.deps.model,
        schema: digestSchema,
        system: this.deps.system,
        messages: [{ role: "user", content: material }],
        providerOptions: { openai: { reasoningEffort: "low" } },
      });
      const digest = result.object;
      await this.deps.digests.write(day, digest.narrative, digest.facts, digest.threads, this.deps.modelId);
      log(`${day} folded: ${studied.length} moments, ${spoken.length} sayings, ${Date.now() - started}ms`);
    } catch (error) {
      log(`fold failed: ${String(error).slice(0, 160)}`);
    } finally {
      this.folding = false;
    }
  }
}

function previousDay(day: string): string {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function peopleNote(peopleJson: string): string {
  try {
    const people = JSON.parse(peopleJson) as { name: string }[];
    if (people.length === 0) return "";
    return ` People: ${people.map((person) => person.name).join(", ")}.`;
  } catch {
    return "";
  }
}

function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 23)} STORY ${message}`);
}
