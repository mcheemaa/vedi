import { readFileSync } from "node:fs";
import { join } from "node:path";

export type AgentDefinition = {
  name: string;
  model: string;
  tools: string[];
  system: string;
};

/** Rendi's agent-as-markdown shape, kept: frontmatter names the wiring,
 * the body IS the system prompt. Deliberately minimal parser: strings
 * and string lists only; anything fancier belongs in code. Worker
 * agents (the dreamer, the narrator) have no tools list. */
export function loadDefinition(repoDir: string, agent = "vedi"): AgentDefinition {
  const source = readFileSync(join(repoDir, "brain", "agents", `${agent}.md`), "utf8");
  const match = source.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) throw new Error(`${agent}.md must start with a --- frontmatter block`);
  const [, frontmatter, body] = match;

  const fields: Record<string, string | string[]> = {};
  let list: string[] | undefined;
  for (const line of frontmatter.split("\n")) {
    if (!line.trim()) continue;
    const item = line.match(/^\s+-\s+(.+)$/);
    if (item) {
      if (!list) throw new Error(`list item outside a list key: "${line.trim()}"`);
      list.push(item[1].trim());
      continue;
    }
    const pair = line.match(/^([A-Za-z][A-Za-z0-9_]*):\s*(.*)$/);
    if (!pair) throw new Error(`unparseable frontmatter line: "${line}"`);
    if (pair[2] === "") {
      list = [];
      fields[pair[1]] = list;
    } else {
      list = undefined;
      fields[pair[1]] = pair[2].trim();
    }
  }

  const name = fields.name;
  const model = fields.model;
  const tools = fields.tools ?? [];
  const system = body.trim();
  if (typeof name !== "string" || typeof model !== "string") {
    throw new Error(`${agent}.md requires string name and model`);
  }
  if (!Array.isArray(tools)) throw new Error(`${agent}.md tools must be a list`);
  if (!system) throw new Error(`${agent}.md body (the system prompt) is empty`);
  return { name, model, tools, system };
}
