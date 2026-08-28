"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCloud, type Hover } from "@/components/brain-cloud";
import { MomentSheet } from "@/components/moment-sheet";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import type { CloudData, CloudPoint, SearchHit } from "@/lib/surface-types";
import { clock } from "@/lib/surface-types";

/** The brain, full screen: hands on it (orbit), names on it (anchors),
 * and time under it (drag the scrub and watch the day grow). */
export function BrainView({
  data,
  highlight,
  focusPoint,
  onHits,
  onClose,
}: {
  data: CloudData | null;
  highlight: ReadonlySet<string>;
  focusPoint: CloudPoint | null;
  onHits: (hits: SearchHit[]) => void;
  onClose: () => void;
}) {
  const total = data?.points.length ?? 0;
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<Hover>(null);
  const [selected, setSelected] = useState<CloudPoint | null>(null);

  useEffect(() => {
    if (focusPoint) setSelected(focusPoint);
  }, [focusPoint]);
  const visibleCount = scrub ?? total;

  const scrubTime = useMemo(() => {
    if (!data || visibleCount === 0) return null;
    const point = data.points[Math.min(visibleCount, total) - 1];
    return point ? clock(point.ts) : null;
  }, [data, visibleCount, total]);

  return (
    <div className={`absolute inset-0 z-40 bg-background ${hover ? "cursor-pointer" : "cursor-grab active:cursor-grabbing"}`}>
      <BrainCloud
        data={data}
        variant="full"
        highlight={highlight}
        visibleCount={visibleCount}
        onHover={setHover}
        onSelect={(point) => setSelected(point)}
      />

      <div className="pointer-events-none absolute left-5 top-4 flex items-center gap-4">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-[breathe_2.4s_ease-in-out_infinite] bg-voice" aria-hidden />
          <span className="font-mono text-[15px] font-semibold tracking-tight">vedi</span>
        </span>
        <span className="label">the brain · {total.toLocaleString()} moments · drag to turn, scroll to dive</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={onClose}
        className="label absolute right-5 top-4 h-auto rounded-none border-border-soft bg-panel px-3 py-1.5 hover:!text-foreground"
      >
        back to the room · esc
      </Button>

      <div className="label pointer-events-none absolute bottom-24 left-5">
        <span className="text-voice">●</span> ember = just remembered&nbsp;&nbsp;&nbsp;
        <span className="text-foreground">◉</span> breathing = now&nbsp;&nbsp;&nbsp; click a star to open it
      </div>

      <div className="absolute bottom-5 left-5 right-5">
        <div className="mb-2 flex items-baseline justify-between">
          <span className="label">replay the day ── drag to grow the brain</span>
          <span className="label !text-foreground">{scrubTime ?? ""}{scrub === null ? " · now" : ""}</span>
        </div>
        <Slider
          value={[visibleCount]}
          min={Math.min(8, total)}
          max={total}
          step={1}
          onValueChange={([value]) => setScrub(value >= total ? null : value)}
          aria-label="replay the day"
          className="[&_[data-slot=slider-range]]:bg-muted-foreground [&_[data-slot=slider-thumb]]:size-3.5 [&_[data-slot=slider-thumb]]:rounded-none [&_[data-slot=slider-thumb]]:border-voice [&_[data-slot=slider-thumb]]:bg-voice [&_[data-slot=slider-track]]:h-[3px] [&_[data-slot=slider-track]]:rounded-none"
        />
      </div>

      {hover && !selected && (
        <div
          className="label pointer-events-none fixed z-50 border border-border-soft bg-panel px-2.5 py-1.5"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          {clock(hover.point.ts)} · region {hover.point.region}
          {hover.point.keyframe ? " · keyframe" : ""}
        </div>
      )}

      <MomentSheet
        point={selected}
        onClose={() => setSelected(null)}
        onHits={onHits}
      />
    </div>
  );
}
