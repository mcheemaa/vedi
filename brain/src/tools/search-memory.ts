import { tool } from "ai";
import { z } from "zod";
import type { EmbedClient } from "../model/embed-client";
import type { ClickHouse } from "../store/clickhouse";

/** The same semantic search the surface's CMD-K uses, as the agent's
 * own tool: a phrase becomes a vector in the eyes' space and ClickHouse
 * ranks every remembered moment by meaning. */
export function makeSearchMemoryTool(ch: ClickHouse, embed: EmbedClient) {
  return tool({
    description:
      "Search all visual memory by MEANING, not keywords: describe what a moment looked like ('a red door', 'someone holding a can'). Use when recall's keywords fail or the question is about appearance.",
    inputSchema: z.object({
      phrase: z.string().describe("a short visual phrase describing the moment"),
      hours: z.number().describe("how far back to look, in hours; 24 covers today"),
    }),
    execute: async ({ phrase, hours }) => {
      const vector = await embed.embed(`a photo of ${phrase}`);
      if (!vector) return "the eyes' text tower is not available right now";
      const window = Math.min(Math.max(hours, 1), 168);
      const literal = `[${vector.map((value) => value.toFixed(6)).join(",")}]`;

      const rows = await ch.query<{ ts: string; frame_id: string; sim: number; description: string; caption: string }>(`
        SELECT toString(p.ts, 'America/Los_Angeles') AS ts,
               toString(p.frame_id) AS frame_id,
               round(1 - cosineDistance(p.embedding, ${literal}), 3) AS sim,
               d.description AS description,
               e.caption AS caption
        FROM vedi.percepts AS p
        LEFT JOIN vedi.deep AS d ON p.frame_id = d.frame_id
        LEFT JOIN vedi.enrichments AS e ON p.frame_id = e.frame_id
        WHERE p.ts > now() - INTERVAL ${window} HOUR
        ORDER BY sim DESC
        LIMIT 6`);
      if (rows.length === 0) return `nothing in the last ${window}h to search`;
      return rows
        .map((row) => {
          const what = row.description || row.caption || "a remembered moment";
          return `[${row.ts.slice(5, 16)}] sim ${row.sim}: ${what.slice(0, 180)} (frame ${row.frame_id.slice(0, 8)})`;
        })
        .join("\n");
    },
  });
}
