"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BrainCloud } from "@/components/brain-cloud";
import { BrainView } from "@/components/brain-view";
import { Rail } from "@/components/rail";
import { Reel } from "@/components/reel";
import { SearchCommand } from "@/components/search-command";
import { StagePane } from "@/components/stage";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { regionColor } from "@/lib/palette";
import type { CloudData, CloudPoint, Pulse, SearchHit, Thought } from "@/lib/surface-types";
import { thoughtKey } from "@/lib/surface-types";
import { usePoll } from "@/lib/use-poll";
import { type StreamEvent, useStream } from "@/lib/use-stream";

export default function Surface() {
  const pulse = usePoll<Pulse>("/api/pulse", 2500);
  const cloud = usePoll<CloudData>("/api/cloud", 4000);
  const [live, setLive] = useState<Thought[]>([]);
  const [liveFrame, setLiveFrame] = useState<{ frame_id: string; ts: string } | null>(null);
  const [spoken, setSpoken] = useState<Thought | null>(null);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [brainFull, setBrainFull] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [highlight, setHighlight] = useState<ReadonlySet<string>>(new Set());
  const [focusPoint, setFocusPoint] = useState<CloudPoint | null>(null);

  const onEvent = useCallback((event: StreamEvent) => {
    if (event.type === "thought") {
      setLive((current) => [...current.slice(-80), event]);
      setThinking(false);
      if ((event.action === "speak" || event.action === "reply") && event.text) {
        setSpoken(event);
      }
    } else if (event.type === "frame") {
      setLiveFrame({ frame_id: event.frameId, ts: event.ts });
    } else if (event.type === "speaking") {
      setSpeaking(event.on);
    }
  }, []);
  useStream(onEvent);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.closest("input, textarea, [contenteditable]");
      if ((event.metaKey || event.ctrlKey) && event.key === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (!typing && (event.key === "b" || event.key === "B")) setBrainFull((value) => !value);
      if (event.key === "Escape") setBrainFull(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const onHits = useCallback((hits: SearchHit[]) => {
    setHighlight(new Set(hits.map((hit) => hit.frame_id)));
  }, []);

  /** A chosen search hit opens in the brain with its sidebar when the
   * moment is inside the projected sample. */
  const onLocate = useCallback(
    (hit: SearchHit): boolean => {
      const point = cloud?.points.find((candidate) => candidate.id === hit.frame_id);
      if (!point) return false;
      setFocusPoint(point);
      setBrainFull(true);
      return true;
    },
    [cloud],
  );

  const railThoughts = useMemo(() => {
    const seen = new Map<string, Thought>();
    for (const thought of [...(pulse?.thoughts ?? [])].reverse()) {
      seen.set(thoughtKey(thought), thought);
    }
    for (const thought of live) seen.set(thoughtKey(thought), thought);
    return [...seen.values()];
  }, [pulse, live]);

  return (
    <main className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="flex min-w-0 flex-1 flex-col">
        <StagePane pulse={pulse} spoken={spoken} liveFrame={liveFrame} onSearch={() => setSearchOpen(true)} />
        <Reel liveFrame={liveFrame} keyframes={pulse?.keyframes ?? 0} />
        <div className="flex h-9 flex-none items-center gap-1.5 overflow-x-auto border-t border-border-soft bg-panel px-4 scroll-thin">
          <span className="label flex-none">regions</span>
          {(pulse?.regions ?? []).slice(0, 10).map((region) => (
            <Badge
              key={region.region_id}
              variant="outline"
              className="label flex-none gap-1.5 rounded-none border-border-soft"
            >
              <span
                className="inline-block h-1.5 w-1.5"
                style={{ background: regionColor(region.region_id) }}
                aria-hidden
              />
              {region.label || `region ${region.region_id}`}
              <span className="opacity-60">{region.member_count}</span>
            </Badge>
          ))}
        </div>
      </div>

      <div className="hidden w-[404px] flex-none flex-col border-l border-border-soft lg:flex">
        <Button
          variant="ghost"
          onClick={() => setBrainFull(true)}
          aria-label="expand the brain"
          className="group relative block h-44 flex-none rounded-none border-b border-border-soft bg-background p-0 text-left hover:bg-background"
        >
          <BrainCloud data={cloud} variant="tile" highlight={highlight} />
          <span className="label absolute left-4 top-2.5">the brain</span>
          <span className="label absolute right-3 top-2.5 opacity-0 transition-opacity group-hover:opacity-100">
            expand ⤢
          </span>
        </Button>
        <Rail live={railThoughts} thinking={thinking} speaking={speaking} />
      </div>

      {brainFull && (
        <BrainView
          data={cloud}
          highlight={highlight}
          focusPoint={focusPoint}
          onHits={onHits}
          onClose={() => {
            setBrainFull(false);
            setFocusPoint(null);
          }}
        />
      )}

      <SearchCommand open={searchOpen} onOpenChange={setSearchOpen} onHits={onHits} onOpenBrain={() => setBrainFull(true)} onLocate={onLocate} />
    </main>
  );
}
