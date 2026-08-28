"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { regionColor } from "@/lib/palette";
import { BRAIN_URL, clock, type SearchHit } from "@/lib/surface-types";

/** Search the brain in its own language: the query becomes a vector,
 * ClickHouse ranks every remembered moment (nearest kept frame rides
 * along via ASOF JOIN), the matches ignite in the galaxy as you type,
 * and choosing one opens the moment itself. */
export function SearchCommand({
  open,
  onOpenChange,
  onHits,
  onOpenBrain,
  onLocate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHits: (hits: SearchHit[]) => void;
  onOpenBrain: () => void;
  /** Returns true when the moment was found and opened in the brain. */
  onLocate: (hit: SearchHit) => boolean;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [chosen, setChosen] = useState<SearchHit | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    clearTimeout(timer.current);
    if (!query.trim()) {
      setHits([]);
      onHits([]);
      return;
    }
    timer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        const data = (await res.json()) as { results: SearchHit[] };
        setHits(data.results);
        onHits(data.results);
      } catch {
        // keep prior results
      } finally {
        setSearching(false);
      }
    }, 350);
    return () => clearTimeout(timer.current);
  }, [query, onHits]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      onHits([]);
    }
  }, [open, onHits]);

  return (
    <>
      <CommandDialog
        open={open}
        onOpenChange={onOpenChange}
        title="search the memory"
        description="vector search over everything seen"
        className="top-[10%] max-w-[56rem] border border-border-soft bg-panel shadow-[0_24px_80px_rgba(0,0,0,.6)] sm:max-w-[56rem]"
      >
        <Command
          shouldFilter={false}
          className="bg-transparent [&_[data-slot=command-input-wrapper]]:h-[68px] [&_[data-slot=command-input-wrapper]]:gap-3 [&_[data-slot=command-input-wrapper]]:border-border-soft [&_[data-slot=command-input-wrapper]]:px-6 [&_[data-slot=command-input-wrapper]_svg]:size-5"
        >
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="search everything it has seen…"
            className="h-[68px] font-mono text-lg placeholder:text-muted-foreground/50"
          />
          <CommandList className="max-h-[56vh]">
            <CommandEmpty className="px-6 py-8 text-left">
              {searching ? (
                <span className="label">searching the brain…</span>
              ) : query ? (
                <span className="label">nothing that close in memory</span>
              ) : (
                <span className="block">
                  <span className="label block">matches ignite in the brain · try</span>
                  <span className="mt-3 flex flex-wrap gap-2">
                    {["a man holding a can", "the kitchen at night", "a phone in his hand"].map((suggestion) => (
                      <Button
                        key={suggestion}
                        variant="outline"
                        size="sm"
                        onClick={() => setQuery(suggestion)}
                        className="h-auto rounded-none border-border-soft px-3 py-1.5 font-mono text-[12px] font-normal text-muted-foreground hover:text-foreground"
                      >
                        {suggestion}
                      </Button>
                    ))}
                  </span>
                </span>
              )}
            </CommandEmpty>
            {hits.map((hit) => (
              <CommandItem
                key={hit.frame_id}
                value={hit.frame_id}
                onSelect={() => {
                  if (onLocate(hit)) onOpenChange(false);
                  else setChosen(hit);
                }}
                className="gap-5 rounded-none px-6 py-3 aria-selected:bg-panel-2"
              >
                <FrameThumb hit={hit} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px]">
                    {hit.caption || "an unlabeled moment"}
                  </span>
                  <span className="label mt-1 block">
                    {clock(hit.ts)}&nbsp;·&nbsp;
                    <span style={{ color: regionColor(hit.region_id) }}>■</span>&nbsp;region {hit.region_id}
                  </span>
                </span>
                <span className="flex-none font-mono text-[13px] text-voice">{hit.sim.toFixed(3)}</span>
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>

      <Dialog open={chosen !== null} onOpenChange={(next) => !next && setChosen(null)}>
        <DialogContent className="max-w-[56rem] overflow-hidden border-border-soft bg-panel p-0 sm:max-w-[56rem]">
          <DialogTitle className="sr-only">remembered moment</DialogTitle>
          {chosen && (
            <figure>
              {chosen.nearest_frame ? (
                // biome-ignore lint/performance/noImgElement: localhost stream
                <img
                  src={`${BRAIN_URL}/frames/${chosen.nearest_frame}`}
                  alt="remembered moment"
                  className="w-full"
                />
              ) : (
                <div className="label flex h-40 items-center justify-center">vector-only moment</div>
              )}
              <figcaption className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{chosen.caption || "an unlabeled moment"}</span>
                  <span className="label mt-1 block">
                    {clock(chosen.ts)} · sim {chosen.sim.toFixed(3)}
                    {chosen.keyframe !== 1 && chosen.nearest_frame ? " · nearest kept frame shown" : ""}
                  </span>
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="label h-auto flex-none rounded-none border-voice px-3 py-2 !text-voice hover:bg-voice/10"
                  onClick={() => {
                    setChosen(null);
                    onOpenChange(false);
                    onOpenBrain();
                  }}
                >
                  view in the brain
                </Button>
              </figcaption>
            </figure>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}


function FrameThumb({ hit }: { hit: SearchHit }) {
  const [dead, setDead] = useState(false);
  if (!hit.nearest_frame || dead) {
    return (
      <span
        className="label flex h-20 w-[142px] flex-none items-center justify-center border border-border-soft"
        style={{ background: `${regionColor(hit.region_id)}18` }}
      >
        vector
      </span>
    );
  }
  return (
    <span className="relative flex-none">
      {/* biome-ignore lint/performance/noImgElement: localhost stream */}
      <img
        src={`${BRAIN_URL}/frames/${hit.nearest_frame}`}
        alt=""
        onError={() => setDead(true)}
        className={`h-20 w-[142px] border border-border-soft object-cover ${hit.keyframe === 1 ? "" : "opacity-75"}`}
      />
      {hit.keyframe !== 1 && (
        <span className="label absolute bottom-0 right-0 bg-black/70 px-1 py-0.5 !text-[8px]">nearest</span>
      )}
    </span>
  );
}
