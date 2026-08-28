"use client";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { BRAIN_URL, clock, type Thought } from "@/lib/surface-types";

/** The full receipt behind any thought: why, how it was delivered,
 * the frames that justified it, and what it cost. Transparency no
 * black-box demo can offer. */
export function ReceiptSheet({ thought, onClose }: { thought: Thought | null; onClose: () => void }) {
  return (
    <Sheet open={thought !== null} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-[404px] gap-0 border-border-soft bg-panel p-0 sm:max-w-[404px]">
        {thought && (
          <>
            <SheetHeader className="border-b border-border-soft px-5 py-4">
              <SheetTitle className="label !text-foreground/85">
                {thought.action} · {clock(thought.ts)}
              </SheetTitle>
              <SheetDescription className="sr-only">full decision receipt</SheetDescription>
            </SheetHeader>
            <div className="scroll-thin overflow-y-auto px-5 py-4">
              {thought.text && (
                <p className="mb-4 text-[14px] leading-relaxed">{thought.text}</p>
              )}
              <Meta name="why" value={thought.why || "—"} block />
              {thought.delivery && <Meta name="delivery" value={thought.delivery} />}
              <Meta name="kind" value={thought.kind} />
              <Meta name="latency" value={`${Math.round(thought.latency_ms)}ms`} />
              {thought.model && <Meta name="model" value={thought.model} />}
              {typeof thought.input_tokens === "number" && (
                <Meta name="tokens" value={`${thought.input_tokens} in · ${thought.output_tokens ?? 0} out`} />
              )}
              {thought.evidence && thought.evidence.length > 0 && (
                <div className="mt-5">
                  <div className="label mb-2">evidence · {thought.evidence.length} frames</div>
                  <div className="grid grid-cols-2 gap-2">
                    {thought.evidence.map((frameId) => (
                      // biome-ignore lint/performance/noImgElement: localhost stream
                      <img
                        key={frameId}
                        src={`${BRAIN_URL}/frames/${frameId}`}
                        alt="evidence frame"
                        className="aspect-video w-full border border-border-soft object-cover"
                        onError={(event) => {
                          (event.target as HTMLImageElement).style.display = "none";
                        }}
                      />
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

function Meta({ name, value, block }: { name: string; value: string; block?: boolean }) {
  if (block) {
    return (
      <div className="border-b border-border-soft py-2.5">
        <div className="label mb-1">{name}</div>
        <p className="font-mono text-[11.5px] leading-relaxed text-muted-foreground">{value}</p>
      </div>
    );
  }
  return (
    <div className="flex items-baseline justify-between border-b border-border-soft py-2.5">
      <span className="label">{name}</span>
      <span className="font-mono text-[11.5px] text-foreground">{value}</span>
    </div>
  );
}
