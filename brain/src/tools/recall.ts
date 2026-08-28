import { tool } from "ai";
import { z } from "zod";
import type { ClickHouse } from "../store/clickhouse";

/** Memory search over what was seen (captions, screen text), what
 * happened (events), and what Vedi itself said (traces). Keyword tier;
 * the semantic tier arrives when the Eye exposes its text tower. */
export function makeRecallTool(ch: ClickHouse) {
  return tool({
    description:
      "Search visual memory: scene descriptions, text seen on screens, events, and things you said. Use for any question about the past.",
    inputSchema: z.object({
      query: z.string().describe("keywords to search for, e.g. 'celsius can' or 'person entered'"),
      hours: z.number().describe("how far back to look, in hours; 12 covers today"),
    }),
    execute: async ({ query, hours }) => {
      const words = query
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((word) => word.length >= 3)
        .slice(0, 6);
      if (words.length === 0) return "query too short to search";
      const needles = `[${words.map((word) => `'${word}'`).join(",")}]`;
      const window = Math.min(Math.max(hours, 1), 168);

      const [studied, seen, happened, said] = await Promise.all([
        ch.query<{ ts: string; description: string; text_read: string; place: string }>(`
          SELECT toString(d.ts, 'America/Los_Angeles') AS ts, d.description AS description, d.text_read AS text_read, d.place AS place
          FROM vedi.deep AS d FINAL
          WHERE d.ts > now() - INTERVAL ${window} HOUR AND d.description != ''
            AND (multiSearchAnyCaseInsensitive(d.description, ${needles})
              OR multiSearchAnyCaseInsensitive(d.text_read, ${needles})
              OR multiSearchAnyCaseInsensitive(d.place, ${needles})
              OR multiSearchAnyCaseInsensitive(d.notable, ${needles})
              OR multiSearchAnyCaseInsensitive(d.people, ${needles}))
          ORDER BY d.ts DESC LIMIT 6`),
        ch.query<{ ts: string; caption: string; ocr_text: string }>(`
          SELECT toString(ts, 'America/Los_Angeles') AS ts, caption, ocr_text FROM vedi.enrichments
          WHERE ts > now() - INTERVAL ${window} HOUR
            AND (multiSearchAnyCaseInsensitive(caption, ${needles})
              OR multiSearchAnyCaseInsensitive(ocr_text, ${needles}))
          ORDER BY ts DESC LIMIT 8`),
        ch.query<{ ts: string; kind: string; detail: string }>(`
          SELECT toString(ts, 'America/Los_Angeles') AS ts, kind, detail FROM vedi.events
          WHERE ts > now() - INTERVAL ${window} HOUR
            AND multiSearchAnyCaseInsensitive(concat(kind, ' ', detail), ${needles})
          ORDER BY ts DESC LIMIT 6`),
        ch.query<{ ts: string; action: string; text: string }>(`
          SELECT toString(ts, 'America/Los_Angeles') AS ts, action, text FROM vedi.traces
          WHERE ts > now() - INTERVAL ${window} HOUR AND text != ''
            AND multiSearchAnyCaseInsensitive(text, ${needles})
          ORDER BY ts DESC LIMIT 4`),
      ]);

      const lines: string[] = [];
      for (const row of studied) {
        const extras = [row.place, row.text_read ? `text: ${row.text_read.slice(0, 80)}` : ""]
          .filter((part) => part !== "")
          .join(" | ");
        lines.push(`[studied ${row.ts}] ${row.description}${extras ? ` (${extras})` : ""}`);
      }
      for (const row of seen) {
        lines.push(`[seen ${row.ts}] ${row.caption}${row.ocr_text ? ` | text: ${row.ocr_text.slice(0, 60)}` : ""}`);
      }
      for (const row of happened) lines.push(`[event ${row.ts}] ${row.kind}: ${row.detail}`);
      for (const row of said) lines.push(`[you ${row.action} ${row.ts}] ${row.text}`);
      return lines.length > 0 ? lines.join("\n") : `nothing in memory matching "${query}" in the last ${window}h`;
    },
  });
}
