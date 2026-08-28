import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";

/** Walks upward from cwd so the Brain finds vedi/.env.local whether
 * launched from brain/ or the repo root. */
export function loadEnv(filename = ".env.local"): { values: Record<string, string>; directory: string } {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    try {
      const path = join(dir, filename);
      const text = readFileSync(path, "utf8");
      const values: Record<string, string> = {};
      for (const line of text.split("\n")) {
        if (line.startsWith("#")) continue;
        const eq = line.indexOf("=");
        if (eq === -1) continue;
        values[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
      }
      return { values, directory: dir };
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error(`${filename} not found walking up from ${process.cwd()}`);
}

export function require_(env: Record<string, string>, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`missing environment value: ${key}`);
  return value;
}
