"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { regionColor } from "@/lib/palette";
import { BRAIN_URL, clock, type CloudPoint, type SearchHit } from "@/lib/surface-types";

type Near = {
  thoughts: { ts: string; action: string; text: string; why: string }[];
  caption: string;
  nearestFrame: string | null;
  nearestGap: number | null;
};

/** One remembered moment, opened: its frame if one was kept, its
 * caption, and its neighborhood in time and in meaning. */
export function MomentSheet({
  point,
  onClose,
  onHits,
}: {
  point: CloudPoint | null;
  onClose: () => void;
  onHits: (hits: SearchHit[]) => void;
}) {
  const [near, setNear] = useState<Near | null>(null);
  const [finding, setFinding] = useState(false);
  const [imgDead, setImgDead] = useState(false);

  useEffect(() => {
    setNear(null);
    setImgDead(false);
    if (!point) return;
    fetch(`/api/near?ts=${encodeURIComponent(point.ts)}&frame_id=${point.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: Near | null) => setNear(data))
      .catch(() => {});
  }, [point]);

  const findSimilar = async () => {
    if (!point) return;
    setFinding(true);
    try {
      const res = await fetch(`/api/similar?frame_id=${point.id}`);
      const data = (await res.json()) as { results: SearchHit[] };
      onHits(data.results);
    } finally {
      setFinding(false);
    }
  };

  return (
    <Sheet open={point !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[404px] gap-0 border-border-soft bg-panel p-0 sm:max-w-[404px]">
        {point && (
          <>
            <SheetHeader className="sr-only">
              <SheetTitle>remembered moment</SheetTitle>
              <SheetDescription>frame, caption, and neighborhood</SheetDescription>
            </SheetHeader>
            {point.keyframe && !imgDead ? (
              // biome-ignore lint/performance/noImgElement: localhost stream
              <img
                src={`${BRAIN_URL}/frames/${point.id}`}
                alt="remembered frame"
                onError={() => setImgDead(true)}
                className="h-[228px] w-full border-b border-border-soft object-cover"
              />
            ) : near?.nearestFrame && near.nearestFrame !== point.id ? (
              <figure className="relative border-b border-border-soft">
                {/* biome-ignore lint/performance/noImgElement: localhost stream */}
                <img
                  src={`${BRAIN_URL}/frames/${near.nearestFrame}`}
                  alt="nearest kept frame"
                  className="h-[228px] w-full object-cover opacity-85"
                />
                <figcaption className="label absolute bottom-0 right-0 bg-black/70 px-2 py-1">
                  nearest kept frame{near.nearestGap !== null ? ` · ${near.nearestGap}s away` : ""}
                </figcaption>
              </figure>
            ) : (
              <div className="label flex h-[92px] items-center justify-center border-b border-border-soft bg-panel-2">
                vector-only moment · no frame kept
              </div>
            )}
            <div className="scroll-thin overflow-y-auto px-5 py-4">
              {near?.caption && <p className="mb-4 text-[13.5px] leading-relaxed">{near.caption}</p>}
              <Meta name="time" value={clock(point.ts)} />
              <Meta
                name="region"
                value={
                  <span style={{ color: regionColor(point.region) }}>■ region {point.region}</span>
                }
              />
              <Meta name="frame" value={point.id.slice(0, 8)} />
              <div className="mt-5 space-y-2">
                <Button
                  onClick={findSimilar}
                  disabled={finding}
                  variant="outline"
                  className="label h-10 w-full rounded-none border-voice !text-voice hover:bg-voice/10"
                >
                  {finding ? "searching the brain…" : "find similar moments"}
                </Button>
              </div>
              {near && near.thoughts.length > 0 && (
                <div className="mt-6">
                  <div className="label mb-2">around then</div>
                  <div className="space-y-1.5">
                    {near.thoughts.map((thought) => (
                      <p key={`${thought.ts}-${thought.action}`} className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                        {clock(thought.ts)}&nbsp;
                        <span className={thought.action === "speak" || thought.action === "reply" ? "text-voice" : ""}>
                          {thought.action.toUpperCase()}
                        </span>
                        &nbsp;{thought.text || thought.why}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Meta({ name, value }: { name: string; value: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between border-b border-border-soft py-2.5">
      <span className="label">{name}</span>
      <span className="font-mono text-[11.5px] text-foreground">{value}</span>
    </div>
  );
}
