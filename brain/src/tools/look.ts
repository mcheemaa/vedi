import { generateText, tool } from "ai";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { FrameStore } from "../frame-store";

const GAZE = `You are the full-detail gaze of Vedi, an agent whose everyday
sight is only captions. Describe what is actually in this frame with concrete
specifics: objects and their state, any text you can read verbatim, brands,
titles, colors, what hands are doing. If a question is given, answer it first
and precisely. Only what is visible; never guess beyond the pixels. Three to
six plain sentences.`;

/** The deliberate escape hatch (product law 1 kept intact): pixels go
 * through one stateless vision call and only words come back, so the
 * transcript and memory stay image-free while sight stays available. */
export function makeLookTool(store: FrameStore, vision: LanguageModel) {
  return tool({
    description:
      "Actually look at a kept frame in full detail through a vision model. Use when captions cannot answer: small text, brands, titles, what exactly is in view. Slightly slow; use deliberately.",
    inputSchema: z.object({
      frame_id: z.string().describe("the frame to look at; empty string means the newest kept frame"),
      question: z.string().describe("what you want to know from the frame; empty string for a general look"),
    }),
    execute: async ({ frame_id, question }) => {
      const started = Date.now();
      let note = "";
      let id = frame_id.trim();
      let frame: { ts: string; jpeg: Buffer } | null = id ? await store.lookup(id) : null;
      if (!frame) {
        const newest = await store.newest();
        if (!newest) return "no frames have been kept yet; my eyes have stored nothing to look at";
        if (id) note = ` (frame ${id.slice(0, 8)} was not kept; only settled keyframes are stored, so this is the newest kept frame instead)`;
        id = newest.frame_id;
        frame = newest;
      }
      const age = Math.max(0, Math.round((Date.now() - Date.parse(`${frame.ts.replace(" ", "T")}Z`)) / 1000));

      const result = await generateText({
        model: vision,
        messages: [
          {
            role: "user",
            content: [
              { type: "file", mediaType: "image/jpeg", data: frame.jpeg },
              { type: "text", text: question.trim() ? `${GAZE}\n\nQuestion: ${question}` : GAZE },
            ],
          },
        ],
        providerOptions: { openai: { reasoningEffort: "low" } },
      });
      console.log(`${new Date().toISOString().slice(11, 23)} LOOK  frame ${id.slice(0, 8)} age ${age}s ${Date.now() - started}ms`);
      return `[looked at frame ${id.slice(0, 8)}, captured ${age}s ago${note}]\n${result.text.trim()}`;
    },
  });
}
