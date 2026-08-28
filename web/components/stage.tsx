"use client";

import { useEffect, useRef, useState } from "react";
import { Captions } from "@/components/captions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { BRAIN_URL, type Pulse, type Thought } from "@/lib/surface-types";

/** The room, full bleed: the pixels Vedi never receives, with only
 * thin instrument truth laid over them. */
export function StagePane({
  pulse,
  spoken,
  liveFrame,
  onSearch,
}: {
  pulse: Pulse | null;
  spoken: Thought | null;
  liveFrame: { frame_id: string; ts: string } | null;
  onSearch: () => void;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState<"idle" | "live" | "denied">("idle");
  const [source, setSource] = useState<"mirror" | "eyes">("mirror");
  const [fallbackFrame, setFallbackFrame] = useState<string | null>(null);

  // Her-eyes mode before any live frame arrives: borrow the newest kept
  // frame so the switch never lands on black.
  useEffect(() => {
    if (source !== "eyes" || liveFrame || fallbackFrame) return;
    fetch(`${BRAIN_URL}/frames/recent`)
      .then((res) => (res.ok ? res.json() : []))
      .then((rows: { frame_id: string }[]) => rows[0] && setFallbackFrame(rows[0].frame_id))
      .catch(() => {});
  }, [source, liveFrame, fallbackFrame]);
  const eyesFrame = liveFrame?.frame_id ?? fallbackFrame;

  useEffect(() => {
    let stream: MediaStream | null = null;
    navigator.mediaDevices
      ?.getUserMedia({ video: { width: 1280, height: 720 }, audio: false })
      .then((granted) => {
        stream = granted;
        if (video.current) {
          video.current.srcObject = granted;
          setCamera("live");
        }
      })
      .catch(() => setCamera("denied"));
    return () => stream?.getTracks().forEach((track) => track.stop());
  }, []);

  const status = !pulse
    ? { word: "CONNECTING", tone: "text-muted-foreground", square: "bg-muted-foreground" }
    : !pulse.brainUp
      ? { word: "BRAIN OFFLINE", tone: "text-red-400", square: "bg-red-400" }
      : pulse.eyesOpen
        ? { word: "WATCHING", tone: "text-emerald-400", square: "bg-emerald-400 animate-[breathe_2.4s_ease-in-out_infinite]" }
        : { word: "EYES CLOSED", tone: "text-amber-400", square: "bg-amber-400" };

  return (
    <div className="relative min-h-0 flex-1 overflow-hidden bg-black">
      <video
        ref={video}
        autoPlay
        playsInline
        muted
        className={`h-full w-full -scale-x-100 object-cover ${source === "eyes" ? "hidden" : ""}`}
      />
      {source === "eyes" &&
        (eyesFrame ? (
          // biome-ignore lint/performance/noImgElement: localhost stream
          <img
            src={`${BRAIN_URL}/frames/${eyesFrame}`}
            alt="the latest frame Vedi kept"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="label absolute inset-0 flex items-center justify-center">
            nothing kept yet · she will keep a frame when the scene settles
          </div>
        ))}
      {source === "mirror" && camera !== "live" && (
        <div className="label absolute inset-0 flex items-center justify-center">
          {camera === "denied" ? "camera permission denied" : "waiting for camera"}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/65 via-transparent to-black/35" />

      <div className="absolute left-5 top-4 flex items-center gap-4">
        <span className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 animate-[breathe_2.4s_ease-in-out_infinite] bg-voice" aria-hidden />
          <span className="font-mono text-[15px] font-semibold tracking-tight text-white">vedi</span>
        </span>
        <span className={`label flex items-center gap-1.5 !text-current ${status.tone}`}>
          <span className={`inline-block h-1.5 w-1.5 ${status.square}`} aria-hidden />
          {status.word}
        </span>
        {pulse?.policy.includes("quiet") && (
          <Badge variant="outline" className="label border-amber-400/40 !text-amber-300">
            QUIET MODE
          </Badge>
        )}
      </div>

      <div className="absolute right-5 top-4 flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setSource(source === "mirror" ? "eyes" : "mirror")}
          aria-pressed={source === "eyes"}
          aria-label="toggle between the room mirror and the frames Vedi keeps"
          className="label h-auto rounded-none border-border-soft bg-black/45 px-2.5 py-1.5 hover:bg-black/60 hover:!text-white"
        >
          {source === "mirror" ? "VIEW: MIRROR" : "VIEW: HER EYES"}
        </Button>
        <span className="label hidden items-center gap-2 border border-border-soft bg-black/45 px-2.5 py-1.5 lg:flex">
          <Sparkline values={pulse?.spark ?? []} />
          {rate(pulse?.spark)} / MIN
        </span>
        <span className="label border border-border-soft bg-black/45 px-2.5 py-1.5">
          {pulse?.silences ?? 0} SILENCES TODAY
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onSearch}
          aria-label="search the memory"
          className="label h-auto gap-2 rounded-none border-border-soft bg-black/45 px-2.5 py-1.5 hover:bg-black/60 hover:!text-white"
        >
          SEARCH <Kbd className="bg-white/10 text-white/80">⌘K</Kbd>
        </Button>
      </div>

      <Captions spoken={spoken} />

      {pulse && pulse.brainUp && !pulse.eyesOpen && (
        <div className="absolute bottom-5 right-5">
          <span className="label border border-amber-400/40 bg-black/55 px-3 py-2 !text-amber-300">
            VEDI&rsquo;S EYE IS OFF · START THE EYE WITH --LOOP
          </span>
        </div>
      )}
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <span className="inline-block h-[10px] w-[46px]" aria-hidden />;
  const max = Math.max(...values, 1);
  const points = values
    .map((value, index) => `${(index / (values.length - 1)) * 46},${10 - (value / max) * 9}`)
    .join(" ");
  return (
    <svg width="46" height="10" aria-hidden>
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function rate(spark?: number[]): number {
  if (!spark || spark.length === 0) return 0;
  return spark[spark.length - 1] ?? 0;
}
