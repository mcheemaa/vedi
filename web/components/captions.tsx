"use client";

import { useEffect, useRef, useState } from "react";
import type { Thought } from "@/lib/surface-types";
import { clock } from "@/lib/surface-types";

/** Broadcast lower-third: her words stream onto the video as she says
 * them, delivery direction above, receipts below, gone in a few
 * breaths (the rail keeps them forever). */
export function Captions({ spoken }: { spoken: Thought | null }) {
  const [visible, setVisible] = useState<Thought | null>(null);
  const [typed, setTyped] = useState("");
  const timer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const fade = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!spoken?.text) return;
    setVisible(spoken);
    clearInterval(timer.current);
    clearTimeout(fade.current);

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setTyped(spoken.text);
    } else {
      setTyped("");
      const text = spoken.text;
      let index = 0;
      timer.current = setInterval(() => {
        index += 2;
        setTyped(text.slice(0, index));
        if (index >= text.length) clearInterval(timer.current);
      }, 34);
    }
    fade.current = setTimeout(() => setVisible(null), 11000);
    return () => {
      clearInterval(timer.current);
      clearTimeout(fade.current);
    };
  }, [spoken]);

  if (!visible) return null;
  const done = typed.length >= visible.text.length;

  return (
    <div className="pointer-events-none absolute bottom-8 left-6 right-6 max-w-3xl" aria-live="polite">
      {visible.delivery && (
        <div className="label mb-2 !text-voice">── {visible.delivery}</div>
      )}
      <p className="text-[clamp(20px,2.4vw,32px)] font-medium leading-[1.28] text-white [text-shadow:0_2px_24px_rgba(0,0,0,.8)]">
        {typed}
        {!done && <span className="ml-0.5 inline-block h-[0.9em] w-[3px] animate-[caret_.8s_step-end_infinite] bg-voice align-middle" />}
      </p>
      <div className="label mt-2">
        {clock(visible.ts)}&nbsp; {visible.kind === "user" ? "REPLY" : "UNPROMPTED"}&nbsp; ·&nbsp; {(visible.latency_ms / 1000).toFixed(1)}s
      </div>
    </div>
  );
}
