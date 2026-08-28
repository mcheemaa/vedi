import { generateObject, stepCountIs, streamText } from "ai";
import { z } from "zod";
import type { LanguageModel, ModelMessage, ToolSet } from "ai";
import type { Policy } from "../context/policy";
import { buildVisionState } from "../context/vision-state";
import type { ClickHouse } from "../store/clickhouse";
import type { Digests } from "../store/digests";
import { localDay } from "../store/digests";
import type { Facts } from "../store/facts";
import type { Traces } from "../store/traces";
import { publish } from "../bus";
import type { Say } from "../voice/say";

export type PerceptEvent = {
  ts: string;
  kind: string;
  detail: string;
  frame_id: string;
};

/** All-required by OpenAI's strict structured-output rule; text is
 * empty when not speaking. */
const decisionSchema = z.object({
  action: z.enum(["speak", "note", "ignore"]),
  text: z.string(),
  delivery: z.string(),
  why: z.string(),
  evidence: z.array(z.string()),
});

type RingTurn = { role: "user" | "assistant"; content: string };

/** The percept loop: single-flight, never done. ClickHouse is the
 * transcript; this class holds only a working-set cache (a ring of
 * recent turns plus a rolling self-summary) that a restart rebuilds
 * from the traces table. */
export class Loop {
  private pending: PerceptEvent[] = [];
  private userQueue: { text: string; resolve: (reply: string) => void }[] = [];
  private heartbeatDue = false;
  private running = false;
  private ring: RingTurn[] = [];
  private summary = "";
  private turns = 0;
  private lastAction = "none";

  constructor(
    private readonly deps: {
      model: LanguageModel;
      modelId: string;
      system: string;
      tools: ToolSet;
      ch: ClickHouse;
      traces: Traces;
      facts: Facts;
      digests: Digests;
      policy: Policy;
      say: Say;
    },
  ) {}

  /** Rebuild the working set from the transcript that survived. */
  async boot(): Promise<void> {
    const recent = await this.deps.ch.query<{ kind: string; action: string; text: string; why: string }>(`
      SELECT kind, action, text, why FROM vedi.traces
      WHERE action != 'skip' ORDER BY ts DESC LIMIT 6`);
    for (const row of recent.reverse()) {
      this.ring.push({ role: "assistant", content: turnRecord(row.kind, row.action, row.text, row.why) });
    }
  }

  onPercept(event: PerceptEvent): void {
    this.pending.push(event);
    this.pump();
  }

  /** The user owns the floor: current speech stops mid-word (barge-in)
   * and the user turn jumps every queued percept. */
  onUser(text: string): Promise<string> {
    this.deps.say.stop();
    return new Promise((resolve) => {
      this.userQueue.push({ text, resolve });
      this.pump();
    });
  }

  onHeartbeat(): void {
    this.heartbeatDue = true;
    this.pump();
  }

  stats(): Record<string, unknown> {
    return {
      turns: this.turns,
      lastAction: this.lastAction,
      pending: this.pending.length,
      ring: this.ring.length,
      summary: this.summary.length > 0,
    };
  }

  /** Single flight with a priority lane: one turn at a time, user turns
   * first, then batched percepts, then a due heartbeat. */
  private pump(): void {
    if (this.running) return;
    this.running = true;
    void (async () => {
      try {
        while (this.userQueue.length > 0 || this.pending.length > 0 || this.heartbeatDue) {
          const user = this.userQueue.shift();
          if (user) {
            user.resolve(await this.userTurn(user.text));
            continue;
          }
          if (this.pending.length > 0) {
            await this.perceptTurn();
            continue;
          }
          this.heartbeatDue = false;
          await this.heartbeatTurn();
        }
      } finally {
        this.running = false;
      }
    })();
  }

  private async perceptTurn(): Promise<void> {
    const batch = this.pending.splice(0);
    if (batch.length === 0) return;
    const started = Date.now();
    const eventsBlock = batch
      .map((event) => `EVENT frame_id=${event.frame_id} at ${event.ts}: ${event.kind} (${event.detail})`)
      .join("\n");

    try {
      const [vision, known, story] = await Promise.all([
        buildVisionState(this.deps.ch),
        this.deps.facts.block(),
        this.deps.digests.block(localDay()),
      ]);
      const prompt = [clockLine(), voiceLine(this.deps.say.status()), this.deps.policy.block(), known, story, "", vision, "", eventsBlock, "", "Decide: speak, note, or ignore."]
        .filter((part) => part !== "")
        .join("\n");
      const result = await generateObject({
        model: this.deps.model,
        schema: decisionSchema,
        system: this.deps.system,
        messages: [...this.contextMessages(), { role: "user", content: prompt }],
        providerOptions: { openai: { reasoningEffort: "none" } },
      });

      let { action, text, why, evidence } = result.object;
      const delivery = result.object.delivery;
      if (action !== "ignore" && evidence.length === 0) {
        // The law: no anchored evidence, no utterance.
        action = "ignore";
        why = `demoted: no evidence anchored (was: ${why})`;
        text = "";
      }
      if (action === "speak") this.deps.say.speak(text, delivery, true);

      const turnId = crypto.randomUUID();
      this.lastAction = action;
      this.turns += 1;
      this.remember(`[percepts]\n${eventsBlock}`, turnRecord("percept", action, text, why));
      await this.deps.traces.write({
        turn_id: turnId,
        kind: "percept",
        action,
        text,
        why,
        delivery,
        evidence,
        model: this.deps.modelId,
        latency_ms: Date.now() - started,
        input_tokens: result.usage.inputTokens ?? 0,
        output_tokens: result.usage.outputTokens ?? 0,
      });
      publish("thought", {
        turn_id: turnId,
        ts: wire(new Date()),
        kind: "percept",
        action,
        text,
        why,
        delivery,
        latency_ms: Date.now() - started,
      });
      log(`percept turn: ${action}${text ? ` "${text}"` : ""} (${why}) ${Date.now() - started}ms`);
    } catch (error) {
      await this.traceError("percept", started, error);
    }
  }

  private async userTurn(text: string): Promise<string> {
    const started = Date.now();
    try {
      const [vision, known, story] = await Promise.all([
        buildVisionState(this.deps.ch),
        this.deps.facts.block(),
        this.deps.digests.block(localDay()),
      ]);
      const result = streamText({
        model: this.deps.model,
        system: this.deps.system,
        tools: this.deps.tools,
        stopWhen: stepCountIs(5),
        messages: [
          ...this.contextMessages(),
          { role: "user", content: `${clockLine()}\n${this.deps.policy.block()}\n${known}\n${story}\n\n${vision}\n\nSomeone in the room says: "${text}"\n\nReply with only the words you will say aloud: no brackets, no labels, no meta.` },
        ],
        providerOptions: { openai: { reasoningEffort: "low" } },
      });

      // The mouth opens before the reply is finished: each completed
      // sentence starts sounding while the next is still being written.
      const mouth = this.deps.say.speakStream("conversational, matching the mood of the words");
      let pending = "";
      let lead = true;
      for await (const delta of result.textStream) {
        pending += delta;
        if (lead && pending.length > 60) lead = false;
        if (lead) {
          // A leaked stage direction ("[light, friendly] ...") must
          // never reach the voice; strip it at the mouth, not just in
          // the prompt.
          const stripped = pending.replace(/^\s*\[[^\]]{0,40}\]\s*/, "");
          if (stripped !== pending) {
            pending = stripped;
            lead = false;
          }
        }
        let boundary = findSentenceEnd(pending);
        while (boundary !== -1) {
          lead = false;
          mouth.feed(pending.slice(0, boundary));
          pending = pending.slice(boundary).trimStart();
          boundary = findSentenceEnd(pending);
        }
      }
      mouth.feed(pending);
      mouth.done();

      const reply = (await result.text).trim().replace(/^\s*\[[^\]]{0,40}\]\s*/, "");
      const usage = await result.totalUsage;
      const turnId = crypto.randomUUID();
      this.lastAction = "reply";
      this.turns += 1;
      this.remember(`[someone said] ${text}`, turnRecord("user", "reply", reply, ""));
      await this.deps.traces.write({
        turn_id: turnId,
        kind: "user",
        action: "reply",
        text: reply,
        why: `asked: ${text.slice(0, 120)}`,
        delivery: "conversational",
        evidence: [],
        model: this.deps.modelId,
        latency_ms: Date.now() - started,
        input_tokens: usage.inputTokens ?? 0,
        output_tokens: usage.outputTokens ?? 0,
      });
      publish("thought", {
        turn_id: turnId,
        ts: wire(new Date()),
        kind: "user",
        action: "reply",
        text: reply,
        why: `asked: ${text.slice(0, 120)}`,
        delivery: "conversational",
        question: text,
        latency_ms: Date.now() - started,
      });
      log(`user turn: "${text.slice(0, 60)}" -> "${reply.slice(0, 80)}" ${Date.now() - started}ms`);
      return reply;
    } catch (error) {
      await this.traceError("user", started, error);
      return "something went wrong in my head; check the brain log";
    }
  }

  /** Time-driven awareness. Skips are traced with a reason so silence
   * stays auditable; the model is only woken when the eyes are open
   * and something has actually accumulated. */
  private async heartbeatTurn(): Promise<void> {
    const started = Date.now();
    if (this.pending.length > 0) return;
    const skip = async (why: string) => {
      await this.deps.traces.write({
        turn_id: crypto.randomUUID(),
        kind: "heartbeat",
        action: "skip",
        text: "",
        why,
        delivery: "",
        evidence: [],
        model: this.deps.modelId,
        latency_ms: Date.now() - started,
        input_tokens: 0,
        output_tokens: 0,
      });
    };

    const recent = await this.deps.ch.query<{ n: string }>(`
      SELECT toString(count()) AS n FROM vedi.events WHERE ts > now() - INTERVAL 5 MINUTE`);
    if (Number(recent[0]?.n ?? "0") === 0) {
      await skip("nothing happened in the last five minutes");
      return;
    }
    await skip("events already handled by percept turns");
  }

  private async traceError(kind: "percept" | "user" | "heartbeat", started: number, error: unknown): Promise<void> {
    this.lastAction = "error";
    log(`${kind} turn failed: ${String(error).slice(0, 200)}`);
    await this.deps.traces
      .write({
        turn_id: crypto.randomUUID(),
        kind,
        action: "error",
        text: "",
        why: String(error).slice(0, 300),
        delivery: "",
        evidence: [],
        model: this.deps.modelId,
        latency_ms: Date.now() - started,
        input_tokens: 0,
        output_tokens: 0,
      })
      .catch(() => {});
  }

  /** The bounded working set: summary + last N turns, oldest folded
   * into the summary as plain truncation-free bookkeeping. Folding by
   * the model itself lands with the surface; this keeps the contract
   * (context never grows) true from day one. */
  private remember(userSide: string, assistantSide: string): void {
    this.ring.push({ role: "user", content: userSide });
    this.ring.push({ role: "assistant", content: assistantSide });
    while (this.ring.length > 20) {
      const folded = this.ring.splice(0, 2);
      const record = folded.find((turn) => turn.role === "assistant");
      if (record) this.summary = `${this.summary}\n${record.content}`.slice(-1500).trimStart();
    }
  }

  private contextMessages(): ModelMessage[] {
    const messages: ModelMessage[] = [];
    if (this.summary) {
      messages.push({ role: "user", content: `[earlier, folded]\n${this.summary}` });
      messages.push({ role: "assistant", content: "(noted)" });
    }
    for (const turn of this.ring) messages.push({ role: turn.role, content: turn.content });
    return messages;
  }
}

function clockLine(): string {
  const now = new Date().toLocaleString("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `[now] ${now} (local time; all times you mention are local)`;
}

/** The judgment layer is told when its own mouth is behind, so pacing
 * is a decision, not a rule (grounded-pacing design). */
function voiceLine(status: { speaking: boolean; queued: number }): string {
  if (!status.speaking && status.queued === 0) return "";
  const waiting = status.queued > 0 ? " and one line is already waiting" : "";
  return `[voice] you are mid-line right now${waiting}: prefer silence or one short clause; nothing you skip is lost, memory keeps it.`;
}

/** A sentence is done at . ! ? or an ellipsis followed by space, once
 * it is long enough to be worth a speech request on its own. */
function findSentenceEnd(text: string): number {
  const match = text.match(/[.!?\u2026]["')\]]?\s/);
  if (!match || match.index === undefined) return -1;
  const end = match.index + match[0].length;
  return end < 12 ? -1 : end;
}

function wire(date: Date): string {
  return date.toISOString().replace("T", " ").replace("Z", "");
}

function turnRecord(kind: string, action: string, text: string, why: string): string {
  return `[${kind} -> ${action}]${text ? ` "${text}"` : ""}${why ? ` (${why})` : ""}`;
}

function log(message: string): void {
  console.log(`${new Date().toISOString().slice(11, 23)} LOOP  ${message}`);
}
