import { unlink } from "node:fs/promises";
import { publish } from "../bus";
import { generateSpeech } from "ai";
import type { SpeechModel } from "ai";

type Player = Bun.Subprocess<"pipe", "ignore", "pipe">;

export type VoiceConfig = {
  apiKey: string;
  modelId: string;
  model: SpeechModel;
  voice: string;
};

const BASE_DELIVERY =
  "A warm, playful friend in the room, speaking briefly and naturally. Never performative, never customer-service toned.";

/** The mouth. Three rungs, best first: streamed PCM piped straight into
 * ffplay so the first sound lands at the API's first byte (~0.5s);
 * buffered mp3 via afplay when streaming is unavailable; /usr/bin/say
 * when the network itself is gone. Serialized so speech never overlaps. */
export class Say {
  private chain: Promise<void> = Promise.resolve();
  private counter = 0;
  private readonly ffplay: boolean;
  /** Barge-in: bumping the generation abandons queued speech; killing
   * the current player cuts audio mid-word, like a person interrupted. */
  private generation = 0;
  private current: ReturnType<typeof Bun.spawn> | null = null;
  private speakingNow = false;
  /** The revocable slot (incremental-unit semantics): at most one
   * unstarted proactive line; a newer one replaces it, the playing
   * line always finishes. Grounded-pacing design, 2026-08-28. */
  private pendingRevocable: { text: string; delivery: string } | null = null;

  constructor(
    private readonly tts: VoiceConfig | null,
    private readonly fallbackVoice?: string,
  ) {
    this.ffplay = Bun.which("ffmpeg") !== null;
  }

  /** delivery is the agent's own stage direction for this utterance;
   * empty falls back to the house read. */
  stop(): void {
    this.generation += 1;
    this.pendingRevocable = null;
    this.current?.kill();
    this.current = null;
  }

  /** What the judgment layer is told about the mouth. */
  status(): { speaking: boolean; queued: number } {
    return { speaking: this.speakingNow, queued: this.pendingRevocable ? 1 : 0 };
  }

  speak(text: string, delivery = "", revocable = false): void {
    if (!text) return;
    if (revocable && this.pendingRevocable) {
      console.log(`voice: revoked unspoken "${this.pendingRevocable.text.slice(0, 70)}"`);
      this.pendingRevocable.text = text;
      this.pendingRevocable.delivery = delivery;
      return;
    }
    const generation = this.generation;
    const slot = revocable ? { text, delivery } : null;
    if (slot) this.pendingRevocable = slot;
    this.chain = this.chain.then(async () => {
      if (slot && this.pendingRevocable === slot) this.pendingRevocable = null;
      if (generation !== this.generation) return;
      const line = slot ?? { text, delivery };
      publish("speaking", { on: true });
      this.speakingNow = true;
      try {
        await this.speakAny(line.text, line.delivery);
      } finally {
        this.speakingNow = false;
        publish("speaking", { on: false });
      }
    });
  }

  /** One utterance fed sentence by sentence while the reply is still
   * being written: the first sentence sounds while the rest generates.
   * Sentences share one player process so the audio is gapless; stop()
   * still cuts mid-word and abandons whatever was queued. */
  speakStream(delivery = ""): { feed: (sentence: string) => void; done: () => void } {
    const generation = this.generation;
    const streaming = this.tts !== null && this.ffplay;
    // Audio is prefetched the moment a sentence exists, so while one
    // sentence plays the next is already arriving: no seam, no wait.
    const queue: { sentence: string; audio: Promise<Response> | null }[] = [];
    let closed = false;
    let wake: (() => void) | null = null;
    const notify = () => {
      wake?.();
      wake = null;
    };

    this.chain = this.chain.then(async () => {
      if (generation !== this.generation) return;

      if (!streaming) {
        while (!closed) await new Promise<void>((resolve) => { wake = resolve; });
        const text = queue.splice(0).map((entry) => entry.sentence).join(" ");
        if (!text || generation !== this.generation) return;
        publish("speaking", { on: true });
        try {
          await this.speakAny(text, delivery);
        } finally {
          publish("speaking", { on: false });
        }
        return;
      }

      let player: Player | null = null;
      const started = Date.now();
      try {
        while (generation === this.generation) {
          if (queue.length === 0) {
            if (closed) break;
            await new Promise<void>((resolve) => { wake = resolve; });
            continue;
          }
          const entry = queue.shift();
          if (!entry?.audio) continue;
          if (!player) {
            publish("speaking", { on: true });
            this.speakingNow = true;
            player = this.spawnPlayer();
            this.current = player;
          }
          await this.pipeResponse(player, await entry.audio, started);
        }
      } catch (error) {
        console.error(`streamed speech failed: ${String(error).slice(0, 150)}`);
      } finally {
        if (player) {
          try {
            player.stdin.end();
          } catch {}
          await player.exited;
          if (this.current === player) this.current = null;
          this.speakingNow = false;
          publish("speaking", { on: false });
        }
      }
    });

    return {
      feed: (sentence: string) => {
        const trimmed = sentence.trim();
        if (!trimmed) return;
        queue.push({
          sentence: trimmed,
          audio: streaming ? this.fetchSpeech(trimmed, delivery) : null,
        });
        notify();
      },
      done: () => {
        closed = true;
        notify();
      },
    };
  }

  private spawnPlayer(): Player {
    return Bun.spawn(
      ["ffmpeg", "-hide_banner", "-loglevel", "error",
       "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "-",
       "-f", "audiotoolbox", "default"],
      { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
    );
  }

  private async fetchSpeech(sentence: string, delivery: string): Promise<Response> {
    return fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tts!.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.tts!.modelId,
        input: sentence,
        voice: this.tts!.voice,
        response_format: "pcm",
        instructions: delivery ? `${BASE_DELIVERY} For this line: ${delivery}` : BASE_DELIVERY,
      }),
    });
  }

  private async pipeResponse(player: Player, response: Response, started: number): Promise<void> {
    if (!response.ok || !response.body) {
      throw new Error(`speech ${response.status}: ${(await response.text()).slice(0, 150)}`);
    }
    let first = true;
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (first) {
        first = false;
        console.log(`voice: sentence audio ~${Date.now() - started}ms in`);
      }
      player.stdin.write(value);
      player.stdin.flush();
    }
  }

  private async speakAny(text: string, delivery: string): Promise<void> {
      if (this.tts && this.ffplay) {
        try {
          await this.speakStreaming(text, delivery);
          return;
        } catch (error) {
          console.error(`streaming tts failed: ${String(error).slice(0, 150)}`);
        }
      }
      if (this.tts) {
        try {
          await this.speakBuffered(text, delivery);
          return;
        } catch (error) {
          console.error(`tts failed, falling back to say: ${String(error).slice(0, 150)}`);
        }
      }
      await this.speakFallback(text);
  }

  /** Raw 24kHz mono s16le from the speech endpoint, played as it
   * arrives. PCM on purpose: no container means nothing to probe and
   * the player starts on the first chunk. */
  private async speakStreaming(text: string, delivery: string): Promise<void> {
    const started = Date.now();
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.tts!.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.tts!.modelId,
        input: text,
        voice: this.tts!.voice,
        response_format: "pcm",
        instructions: delivery ? `${BASE_DELIVERY} For this line: ${delivery}` : BASE_DELIVERY,
      }),
    });
    if (!response.ok || !response.body) {
      throw new Error(`speech ${response.status}: ${(await response.text()).slice(0, 150)}`);
    }

    // ffmpeg straight into CoreAudio (audiotoolbox): ffplay 8 dropped
    // -ac and its SDL path was dying silently in a spawned process.
    const player = Bun.spawn(
      ["ffmpeg", "-hide_banner", "-loglevel", "error",
       "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", "-",
       "-f", "audiotoolbox", "default"],
      { stdin: "pipe", stdout: "ignore", stderr: "pipe" },
    );
    this.current = player;
    let first = true;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (first) {
          first = false;
          console.log(`voice: first sound ~${Date.now() - started}ms`);
        }
        player.stdin.write(value);
        player.stdin.flush();
      }
    } finally {
      player.stdin.end();
    }
    const code = await player.exited;
    const interrupted = this.current !== player;
    this.current = null;
    if (code !== 0 && !interrupted) {
      const stderr = await new Response(player.stderr).text();
      throw new Error(`player exited ${code}: ${stderr.slice(0, 150)}`);
    }
  }

  private async speakBuffered(text: string, delivery: string): Promise<void> {
    const { audio } = await generateSpeech({
      model: this.tts!.model,
      text,
      voice: this.tts!.voice,
      outputFormat: "mp3",
      instructions: delivery ? `${BASE_DELIVERY} For this line: ${delivery}` : BASE_DELIVERY,
    });
    this.counter += 1;
    const path = `/tmp/vedi-voice-${process.pid}-${this.counter}.mp3`;
    await Bun.write(path, audio.uint8Array);
    const proc = Bun.spawn(["/usr/bin/afplay", path], { stdout: "ignore", stderr: "ignore" });
    this.current = proc;
    await proc.exited;
    this.current = null;
    await unlink(path).catch(() => {});
  }

  private async speakFallback(text: string): Promise<void> {
    const args = ["/usr/bin/say"];
    if (this.fallbackVoice) args.push("-v", this.fallbackVoice);
    args.push(text);
    const proc = Bun.spawn(args, { stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  }
}
