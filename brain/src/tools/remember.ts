import { tool } from "ai";
import { z } from "zod";
import type { Facts } from "../store/facts";

/** The agent's pen: names and durable facts, written once, known
 * forever. */
export function makeRememberTool(facts: Facts) {
  return tool({
    description:
      "Permanently remember something durable: a person's name, a preference, a fact about the room. Use when someone introduces themselves or tells you something worth keeping.",
    inputSchema: z.object({
      kind: z.enum(["person", "preference", "fact"]),
      key: z.string().describe("short identifier, e.g. 'the bearded man' or 'cheema'"),
      value: z.string().describe("what to remember, one line"),
    }),
    execute: async ({ kind, key, value }) => {
      await facts.note(kind, key.toLowerCase(), value);
      return `remembered: ${kind} ${key} = ${value}`;
    },
  });
}
