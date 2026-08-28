import type { Loop } from "./loop/loop";
import type { ClickHouse } from "./store/clickhouse";
import type { Watches } from "./store/watches";

const CHECK_MS = 20_000;
const COOLDOWN_MS = 4 * 60_000;

/** Runs the standing watches: every new percept window is scored
 * against each active watch, and a hit becomes a percept the loop
 * judges like any other. Executor-shaped so QueryRunner can take this
 * job when the cloud reaches 26.7. */
export function startWatcher(ch: ClickHouse, watches: Watches, loop: Loop): void {
  let since = new Date();
  setInterval(async () => {
    try {
      const active = await watches.list();
      if (active.length === 0) {
        since = new Date();
        return;
      }
      const from = since.toISOString().replace("T", " ").replace("Z", "");
      since = new Date();
      for (const watch of active) {
        const lastFired = Date.parse(`${watch.last_fired.replace(" ", "T")}Z`);
        if (Date.now() - lastFired < COOLDOWN_MS) continue;
        const rows = await ch.query<{ frame_id: string; sim: number }>(`
          WITH (SELECT embedding FROM vedi.watches FINAL WHERE watch_id = '${watch.watch_id}') AS probe
          SELECT frame_id, round(1 - cosineDistance(embedding, probe), 3) AS sim
          FROM vedi.percepts
          WHERE ts > parseDateTime64BestEffort('${from}')
          ORDER BY sim DESC LIMIT 1`);
        const top = rows[0];
        if (top && top.sim >= watch.threshold) {
          await watches.markFired(watch.watch_id);
          loop.onPercept({
            ts: new Date().toISOString().replace("T", " ").replace("Z", ""),
            kind: "watch_fired",
            detail: `you were watching for "${watch.phrase}" and it just appeared (sim ${top.sim})`,
            frame_id: top.frame_id,
          });
        }
      }
    } catch (error) {
      console.error(`watcher: ${String(error).slice(0, 150)}`);
    }
  }, CHECK_MS);
}
