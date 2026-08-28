"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { BRAIN_URL, clock } from "@/lib/surface-types";

type Frame = { frame_id: string; ts: string };

/** The memory's own band: the video never runs underneath it. Every
 * keyframe at natural width, newest first, arriving with a cooling
 * ember edge. */
export function Reel({ liveFrame, keyframes }: { liveFrame: Frame | null; keyframes: number }) {
  const [frames, setFrames] = useState<Frame[]>([]);
  const [open, setOpen] = useState<Frame | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);

  useEffect(() => {
    fetch(`${BRAIN_URL}/frames/recent`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: Frame[]) => setFrames(rows))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!liveFrame) return;
    setFrames((current) =>
      current.some((frame) => frame.frame_id === liveFrame.frame_id)
        ? current
        : [liveFrame, ...current].slice(0, 48),
    );
    setFresh(liveFrame.frame_id);
    const cool = setTimeout(() => setFresh(null), 9000);
    return () => clearTimeout(cool);
  }, [liveFrame]);

  return (
    <div className="flex h-[152px] flex-none flex-col border-t border-border-soft bg-panel">
      <div className="flex items-center justify-between px-4 pt-2.5">
        <span className="label">
          memory&nbsp; ▸&nbsp; {keyframes.toLocaleString()} keyframes
        </span>
      </div>
      <Carousel opts={{ dragFree: true }} className="min-h-0 flex-1 px-4 pb-3 pt-2">
        <CarouselContent className="-ml-2 h-full">
          {frames.map((frame) => (
            <CarouselItem key={frame.frame_id} className="h-full basis-auto pl-2">
              <Button
                variant="ghost"
                onClick={() => setOpen(frame)}
                aria-label={`remembered frame at ${clock(frame.ts)}`}
                className={`block h-[98px] rounded-none border border-border-soft p-0 transition-transform hover:scale-[1.03] hover:bg-transparent ${
                  fresh === frame.frame_id ? "animate-[ember-cool_9s_ease-out_forwards]" : ""
                }`}
              >
                {/* biome-ignore lint/performance/noImgElement: localhost stream */}
                <img
                  src={`${BRAIN_URL}/frames/${frame.frame_id}`}
                  alt=""
                  loading="lazy"
                  className="h-full w-auto"
                />
              </Button>
            </CarouselItem>
          ))}
          {frames.length === 0 && (
            <CarouselItem className="basis-auto pl-2">
              <span className="label">no keyframes yet</span>
            </CarouselItem>
          )}
        </CarouselContent>
        <CarouselPrevious className="left-1 size-7 rounded-none border-border-soft bg-panel-2" />
        <CarouselNext className="right-1 size-7 rounded-none border-border-soft bg-panel-2" />
      </Carousel>

      <Dialog open={open !== null} onOpenChange={(next) => !next && setOpen(null)}>
        <DialogContent className="max-w-[56rem] overflow-hidden border-border-soft bg-panel p-0 sm:max-w-[56rem]">
          <DialogTitle className="sr-only">remembered frame</DialogTitle>
          {open && (
            <figure>
              {/* biome-ignore lint/performance/noImgElement: localhost stream */}
              <img src={`${BRAIN_URL}/frames/${open.frame_id}`} alt="remembered frame" className="w-full" />
              <figcaption className="label px-4 py-3">
                remembered {clock(open.ts)} · frame {open.frame_id.slice(0, 8)}
              </figcaption>
            </figure>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
