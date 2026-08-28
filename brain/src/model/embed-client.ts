import { join } from "node:path";
import type { FileSink, Subprocess } from "bun";

/** The Eye's text tower as a co-process: spawned once, queried over
 * stdin/stdout, one request in flight at a time. The model stays warm
 * so a query embeds in milliseconds; no server, no ports. */
export class EmbedClient {
  private proc: Subprocess<"pipe", "pipe", "ignore"> | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = "";
  private chain: Promise<unknown> = Promise.resolve();
  private ready = false;

  constructor(private readonly repoDir: string) {}

  async embed(text: string): Promise<number[] | null> {
    const result = this.chain.then(async () => {
      try {
        await this.ensureProcess();
        const clean = text.replace(/\n/g, " ").trim();
        const stdin = this.proc!.stdin as FileSink;
        stdin.write(`${clean}\n`);
        stdin.flush();
        const line = await this.readLine();
        return JSON.parse(line) as number[];
      } catch (error) {
        console.error(`embed failed: ${String(error).slice(0, 150)}`);
        this.dispose();
        return null;
      }
    });
    this.chain = result.catch(() => {});
    return result;
  }

  private async ensureProcess(): Promise<void> {
    if (this.proc && this.ready) return;
    const eyeDir = join(this.repoDir, "eye");
    const binary =
      process.env.VEDI_EYE_BIN ?? join(eyeDir, ".xcodebuild/Build/Products/Debug/VediEye");
    this.proc = Bun.spawn([binary, "--embed-stdin"], {
      cwd: eyeDir,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "ignore",
    });
    this.reader = (this.proc.stdout as ReadableStream<Uint8Array>).getReader();
    const first = await this.readLine();
    if (first !== "ready") throw new Error(`embed co-process said "${first}"`);
    this.ready = true;
    console.log("embed co-process ready (text tower warm)");
  }

  private async readLine(): Promise<string> {
    const decoder = new TextDecoder();
    while (!this.buffer.includes("\n")) {
      const { done, value } = await this.reader!.read();
      if (done) throw new Error("embed co-process exited");
      this.buffer += decoder.decode(value);
    }
    const index = this.buffer.indexOf("\n");
    const line = this.buffer.slice(0, index).trim();
    this.buffer = this.buffer.slice(index + 1);
    return line;
  }

  private dispose(): void {
    this.proc?.kill();
    this.proc = null;
    this.reader = null;
    this.buffer = "";
    this.ready = false;
  }
}
