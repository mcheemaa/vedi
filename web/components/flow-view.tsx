"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { usePoll } from "@/lib/use-poll";
import { useStream } from "@/lib/use-stream";
import type { Pulse } from "@/lib/surface-types";

type EdgeKey = "eyeMind" | "eyeVault" | "cdc" | "mindBrain" | "rows" | "speaks" | "look";

/** The architecture as a live instrument: every pulse on this page is
 * a real event arriving over the same stream and polls the product
 * runs on. Nothing is simulated. */
export function FlowView() {
  const pulse = usePoll<Pulse>("/api/pulse", 2500);
  const [, setTick] = useState(0);
  const fires = useRef<Partial<Record<EdgeKey, number>>>({});
  const [speaking, setSpeaking] = useState(false);
  const dreamtPrev = useRef<number | null>(null);

  const fire = useCallback((edge: EdgeKey) => {
    fires.current[edge] = Date.now();
  }, []);

  useStream(
    useCallback(
      (event) => {
        if (event.type === "frame") {
          fire("eyeMind");
          fire("eyeVault");
        } else if (event.type === "thought") {
          fire("mindBrain");
          if (event.action === "speak" || event.action === "reply") fire("speaks");
        } else if (event.type === "speaking") {
          setSpeaking(event.on);
        }
      },
      [fire],
    ),
  );

  // CDC runs on its own 60s clock; the dreamer's progress arrives as a
  // climbing count, each climb one studied frame flowing back to the mind.
  useEffect(() => {
    fire("cdc");
    const cdc = setInterval(() => fire("cdc"), 60_000);
    const paint = setInterval(() => setTick((value) => value + 1), 160);
    return () => {
      clearInterval(cdc);
      clearInterval(paint);
    };
  }, [fire]);
  useEffect(() => {
    const dreamt = Number(pulse?.dreamer?.dreamt ?? Number.NaN);
    if (!Number.isNaN(dreamt)) {
      if (dreamtPrev.current !== null && dreamt > dreamtPrev.current) fire("rows");
      dreamtPrev.current = dreamt;
    }
  }, [pulse, fire]);

  const active = (edge: EdgeKey) => {
    const at = fires.current[edge];
    return at !== undefined && Date.now() - at < 1400;
  };
  const keyframes = pulse?.keyframes ?? 0;
  const silences = pulse?.silences ?? 0;
  const pending = pulse?.dreamer?.pending ?? "0";
  const dreamt = pulse?.dreamer?.dreamt ?? "0";
  const frames = pulse?.framesStored ?? 0;
  const eyesOpen = pulse?.eyesOpen ?? false;

  return (
    <main className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border-soft px-6 py-3">
        <span className="flex items-center gap-3">
          <span className="inline-block h-2.5 w-2.5 animate-[breathe_2.4s_ease-in-out_infinite] bg-voice" aria-hidden />
          <span className="font-mono text-[15px] font-semibold tracking-tight">vedi</span>
          <span className="label">the flow · live</span>
        </span>
        <span className="flex items-center gap-4">
          <span className={`label ${eyesOpen ? "!text-emerald-400" : "!text-amber-400"}`}>
            {eyesOpen ? "WATCHING" : "EYES CLOSED"}
          </span>
          <Link href="/" className="label border border-border-soft px-2.5 py-1.5 hover:text-foreground">
            STAGE
          </Link>
        </span>
      </header>

      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <svg viewBox="0 0 1080 520" className="max-h-full w-full max-w-[1720px]" role="img" aria-label="live architecture flow">
          <defs>
            <filter id="fire-glow" x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur stdDeviation="2.4" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g fontFamily="ui-monospace, 'SF Mono', Menlo, monospace" fill="var(--foreground)">
            <Panel x={28} y={200} w={190} h={90}>
              <rect x={46} y={220} width={9} height={9} fill="var(--voice)" />
              <text x={64} y={229} fontSize={14}>any camera</text>
              <Label x={46} y={252}>{eyesOpen ? "LIVE NOW" : "EYES OFF"}</Label>
              <Label x={46} y={272}>IPHONE · MACBOOK</Label>
            </Panel>

            <Panel x={234} y={128} w={216} h={232}>
              <Label x={252} y={156} wide>THE EYE · ON DEVICE</Label>
              <Chip x={252} y={172} w={180}>phash gate</Chip>
              <Chip x={252} y={210} w={180}>clip on the ane · 5ms</Chip>
              <Chip x={252} y={248} w={180}>settle gate · keyframes</Chip>
              <Chip x={252} y={286} w={180}>fastvlm caption · ocr</Chip>
              <Label x={252} y={344}>{keyframes} KEYFRAMES TODAY</Label>
            </Panel>

            <Panel x={530} y={56} w={252} h={216}>
              <rect x={548} y={76} width={9} height={9} fill="#f2c744" />
              <Label x={566} y={85} wide>CLICKHOUSE · THE MIND</Label>
              <Chip x={548} y={100} w={146}>percepts · vectors</Chip>
              <Chip x={698} y={100} w={66}>regions</Chip>
              <Chip x={548} y={132} w={88}>traces</Chip>
              <Chip x={644} y={132} w={120}>facts · watches</Chip>
              <Chip x={548} y={164} w={122} flash={active("rows")}>deep · dreams</Chip>
              <Chip x={678} y={164} w={86}>digests</Chip>
              <Label x={548} y={216}>THE TRANSCRIPT IS A TABLE</Label>
              <Label x={548} y={234}>{silences} SILENCES, EACH WITH A REASON</Label>
              <Label x={548} y={252}>ANTI-JOIN AS WORK QUEUE</Label>
            </Panel>

            <Panel x={530} y={336} w={252} h={98}>
              <rect x={548} y={356} width={9} height={9} fill="#5c93c4" />
              <Label x={566} y={365} wide>POSTGRES · THE VAULT</Label>
              <text x={548} y={392} fontSize={11.5}>{frames.toLocaleString()} frames · system of record</text>
              <Label x={548} y={414}>VERIFY-FULL · PINNED CA</Label>
            </Panel>

            <Panel x={852} y={96} w={200} h={230}>
              <Label x={870} y={124} wide>THE BRAIN · BUN</Label>
              <Chip x={870} y={140} w={164} coral>
                <tspan fill="var(--voice)">vedi</tspan> · luna · speaks
              </Chip>
              <Chip x={870} y={182} w={164} flash={active("rows")}>
                dreamer · {pending} left
              </Chip>
              <Chip x={870} y={224} w={164}>narrator · the day</Chip>
              <Label x={870} y={292}>SPEAK · NOTE · IGNORE</Label>
              <Label x={870} y={310}>{dreamt} MOMENTS STUDIED</Label>
            </Panel>

            <g className={speaking ? "" : "opacity-70"}>
              <rect x={852} y={370} width={200} height={64} fill="var(--panel)" stroke="var(--voice)"
                className={speaking ? "animate-[breathe_1.2s_ease-in-out_infinite]" : ""} />
              <rect x={870} y={390} width={9} height={9} fill="var(--voice)" />
              <text x={888} y={399} fontSize={12.5}>voice · coral</text>
              <Label x={870} y={420}>{speaking ? "SPEAKING NOW" : "QUIET"}</Label>
            </g>

            <Edge d="M218 245 H 234" on={eyesOpen} />
            <Edge d="M450 200 L 530 150" on={active("eyeMind")} />
            <Edge d="M450 300 L 530 372" on={active("eyeVault")} />
            <Edge d="M656 336 V 272" on={active("cdc")} />
            <Edge d="M782 130 L 852 130" on={active("mindBrain")} />
            <Edge d="M852 200 L 782 200" on={active("rows")} />
            <Edge d="M782 402 L 852 402" on={active("look")} />
            <Edge d="M952 326 V 370" on={active("speaks")} coral />

            <g fontSize={10.5} fill="var(--muted-foreground)" letterSpacing={1}>
              <text x={458} y={168}>PERCEPTS</text>
              <text x={458} y={182}>VECTORS</text>
              <text x={458} y={316}>KEYFRAMES</text>
              <text x={458} y={330}>JPEG</text>
              <text x={666} y={310}>CDC 60S</text>
              <text x={790} y={118}>CONTEXT</text>
              <text x={790} y={222}>ROWS BACK</text>
              <text x={794} y={390}>LOOK</text>
              <text x={962} y={356}>SPEAKS</text>
            </g>
          </g>
        </svg>
      </div>
    </main>
  );
}

function Panel({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} fill="var(--panel)" stroke="var(--border-soft)" />
      {children}
    </g>
  );
}

function Chip({
  x, y, w, coral, flash, children,
}: { x: number; y: number; w: number; coral?: boolean; flash?: boolean; children: React.ReactNode }) {
  return (
    <g>
      <rect x={x} y={y} width={w} height={coral ? 34 : 30} fill="var(--panel-2)"
        stroke={coral ? "var(--voice)" : "var(--border-soft)"}
        className={flash ? "chip-flash" : ""} strokeOpacity={coral ? 0.6 : 1} />
      <text x={x + 12} y={y + 20} fontSize={11.5}>{children}</text>
    </g>
  );
}

function Label({ x, y, wide, children }: { x: number; y: number; wide?: boolean; children: React.ReactNode }) {
  return (
    <text x={x} y={y} fontSize={wide ? 11 : 10.5} letterSpacing={wide ? 2.5 : 1} fill="var(--muted-foreground)">
      {children}
    </text>
  );
}

function Edge({ d, on, coral }: { d: string; on: boolean; coral?: boolean }) {
  return (
    <g fill="none">
      <path d={d} stroke="var(--border-soft)" strokeWidth={2} strokeDasharray="6 7" className="edge-idle" />
      {on && (
        <path d={d} stroke={coral ? "var(--voice)" : "var(--foreground)"} strokeWidth={2.5}
          className="edge-fire" filter="url(#fire-glow)" />
      )}
    </g>
  );
}
