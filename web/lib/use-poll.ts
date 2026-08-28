"use client";

import { useEffect, useRef, useState } from "react";

/** Polls a JSON endpoint on an interval; keeps the last good value so a
 * blip never blanks the surface mid-demo. */
export function usePoll<T>(url: string, intervalMs: number): T | null {
  const [value, setValue] = useState<T | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });
        if (res.ok && alive.current) setValue(await res.json());
      } catch {
        // keep the last good value
      }
      if (alive.current) timer = setTimeout(tick, intervalMs);
    };
    tick();
    return () => {
      alive.current = false;
      clearTimeout(timer);
    };
  }, [url, intervalMs]);

  return value;
}
