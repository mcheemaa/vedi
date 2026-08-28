# The Vedi constitution

Vedi (Italian: "you see") is an always-alive agent with eyes whose visual
memory is a database. Rendi's sibling. Built for the ClickHouse Japantown
hackathon as a real product, not a demo. The north star lives at
`../local/VISION.md`; the master state at `../local/PROGRESS.md`; the
system flow at `../local/ARCHITECTURE.md`. Internal docs never ship.

## Product law (the contract, binding on every decision)

1. The agent never ingests images; pixels stop at the perception layer.
2. Everything seen becomes durable state the agent receives on its next turn.
3. Silence is free: a stable scene costs zero tokens and near-zero compute.
4. The memory is the intelligence; the brain is small and swappable.
5. It forgets on command, visibly.

## Non-negotiables

- ClickHouse and Postgres are both load-bearing at runtime. If either could
  be removed without the product collapsing, the design is wrong.
- Only the Eye is local (the camera is here); everything else is cloud.
- No shortcuts, no patched symptoms, no demo-ware. Slow is fine; wrong is not.

## Code standards (Cheema's mandate, 2026-08-27, verbatim intent)

- **Principal engineer level. We do not hack it.** Root causes, never
  patches; the designed mechanism, never a workaround.
- **Small files, properly split, properly namespaced.** A file past 300
  lines is probably doing too much; 2,000-line files must not exist. One
  concern per file: every tool, every pipeline stage, every view in its
  own file. Kitchen-sink files are a defect.
- **Comments only where a why deserves one.** A comment explains something
  the code cannot say itself: a constraint, a non-obvious tradeoff, an
  external system's quirk. Narration comments must not exist.
- **Latest stable versions, pinned.** Swift 6.2 / Xcode 26 toolchain,
  current stable SPM dependencies, current stable npm dependencies. No
  betas on the critical path, no stale majors out of inertia.
- Verify against installed reality: the checked-out SDK, the live schema,
  the running process. Never code from memory of how a library usually works.

### Swift (the Eye)

- Swift 6 language mode, strict concurrency, zero warnings tolerated.
- SwiftPM project; no third-party dependency where a first-party framework
  is the designed answer (AVFoundation, Vision, CoreML, Accelerate).
- No force unwraps and no `try!` outside tests; failures are typed and
  surfaced, never swallowed.
- Value types by default; actors own mutable pipeline state.

### TypeScript (the Brain)

- Strict mode, zero suppressions; Biome enforces the house style.
- Vercel AI SDK is the model slot; provider swaps are configuration.
- Tools live one-per-file under `tools/`; prompts in their own files;
  agent definitions only wire pieces together.

## Verification

Nothing is done until exercised end to end with evidence: latency numbers
printed, rows counted in ClickHouse, the real camera on the real Mac.
Claims of success require receipts. UI work is proven with screenshots in
both themes before it is called done.

## Voice

No em dashes anywhere: code, copy, commits, docs. No emojis. No marketing
language. Commits are clean, human, concise, with no co-authored-by lines.
Standing approval (Cheema, 2026-08-27): commit and push to this repo
without asking, always with concise messages; land each finished task as
its own commit.
