/** Attention policy is mutable state injected per turn, never baked
 * into the system prompt, so "quiet mode for the presentation" is a
 * data change the agent itself will eventually be allowed to make. */
export type PolicyMode = "normal" | "quiet";

export class Policy {
  private mode: PolicyMode = "normal";
  private note = "";

  set(mode: PolicyMode, note = ""): void {
    this.mode = mode;
    this.note = note;
  }

  current(): { mode: PolicyMode; note: string } {
    return { mode: this.mode, note: this.note };
  }

  block(): string {
    const lines = [`[attention policy] mode: ${this.mode}`];
    if (this.mode === "quiet") {
      lines.push("Quiet mode: speak only for things that cannot wait; prefer note.");
    } else {
      lines.push("Normal mode: speak when a person would appreciate it; silence is always acceptable.");
    }
    if (this.note) lines.push(`standing note: ${this.note}`);
    return lines.join("\n");
  }
}
