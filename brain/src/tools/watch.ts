import { tool } from "ai";
import { z } from "zod";
import type { EmbedClient } from "../model/embed-client";
import type { Watches } from "../store/watches";

/** Standing watches: the agent schedules its own attention. Each watch
 * is a phrase held as a vector, checked against every new percept. */
export function makeWatchTools(watches: Watches, embed: EmbedClient) {
  return {
    watch_create: tool({
      description:
        "Start watching for something visual ('a dog', 'someone at the door'). You will be told the moment it appears. Confirm to the user in your own words.",
      inputSchema: z.object({
        phrase: z.string().describe("what to watch for, a short visual phrase"),
      }),
      execute: async ({ phrase }) => {
        const vector = await embed.embed(`a photo of ${phrase}`);
        if (!vector) return "the eye is not running, so I cannot embed the watch phrase right now";
        const id = await watches.create(phrase, vector);
        return `watch created: "${phrase}" (${id.slice(0, 8)})`;
      },
    }),
    watch_list: tool({
      description: "List the standing watches currently active.",
      inputSchema: z.object({}),
      execute: async () => {
        const rows = await watches.list();
        if (rows.length === 0) return "no active watches";
        return rows
          .map((row) => `${row.watch_id.slice(0, 8)} · "${row.phrase}" since ${row.created_at}`)
          .join("\n");
      },
    }),
    watch_cancel: tool({
      description: "Cancel a standing watch by its phrase or id.",
      inputSchema: z.object({
        which: z.string().describe("the phrase or id of the watch to cancel"),
      }),
      execute: async ({ which }) => {
        const done = await watches.cancel(which);
        return done ? `watch cancelled: ${which}` : `no active watch matching "${which}"`;
      },
    }),
  };
}
