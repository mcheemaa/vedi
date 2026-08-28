"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReceiptSheet } from "@/components/receipt-sheet";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import type { Thought } from "@/lib/surface-types";
import { clock, thoughtKey } from "@/lib/surface-types";

type Row =
  | { type: "thought"; thought: Thought }
  | { type: "quiet"; thoughts: Thought[] };

/** The instrument's ledger: everything the agent has ever done,
 * scrollable all the way back. Spoken words in Sans, machine truth in
 * mono, silences compressed into tick clusters, every row opening its
 * full receipt. */
export function Rail({
  live,
  thinking,
  speaking,
}: {
  live: Thought[];
  thinking: boolean;
  speaking: boolean;
}) {
  const [handsFree, setHandsFree] = useState(false);
  const [history, setHistory] = useState<Thought[]>([]);
  const [receipt, setReceipt] = useState<Thought | null>(null);
  const [draft, setDraft] = useState("");
  const [partial, setPartial] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  useEffect(() => {
    fetch("/api/thoughts")
      .then((res) => (res.ok ? res.json() : { thoughts: [] }))
      .then((data: { thoughts: Thought[] }) => setHistory(data.thoughts))
      .catch(() => {});
  }, []);

  const thoughts = useMemo(() => {
    const seen = new Map<string, Thought>();
    for (const thought of history) seen.set(thoughtKey(thought), thought);
    for (const thought of live) seen.set(thoughtKey(thought), thought);
    return [...seen.values()].sort((a, b) => a.ts.localeCompare(b.ts));
  }, [history, live]);

  const rows = useMemo(() => cluster(thoughts), [thoughts]);

  useEffect(() => {
    const el = viewport.current;
    if (el && pinned.current) el.scrollTop = el.scrollHeight;
  }, [rows.length, partial]);

  const loadMore = useCallback(async () => {
    if (loadingMore || thoughts.length === 0) return;
    setLoadingMore(true);
    const el = viewport.current;
    const keep = el ? el.scrollHeight - el.scrollTop : 0;
    try {
      const res = await fetch(`/api/thoughts?before=${encodeURIComponent(thoughts[0].ts)}`);
      const data = (await res.json()) as { thoughts: Thought[] };
      if (data.thoughts.length > 0) {
        setHistory((current) => [...data.thoughts, ...current]);
        requestAnimationFrame(() => {
          if (el) el.scrollTop = el.scrollHeight - keep;
        });
      }
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, thoughts]);

  const onScroll = useCallback(() => {
    const el = viewport.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
    if (el.scrollTop < 80) void loadMore();
  }, [loadMore]);

  const send = useCallback(async (text: string) => {
    const clean = text.trim();
    if (!clean) return;
    setDraft("");
    pinned.current = true;
    await fetch("/api/say", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: clean }),
    }).catch(() => {});
  }, []);

  const handsFreeRef = useRef(false);
  const speakingRef = useRef(false);
  handsFreeRef.current = handsFree;
  speakingRef.current = speaking;
  const { start, stop } = useSpeech(setPartial, send, handsFreeRef, speakingRef);

  // Hands-free: the mic stays open between phrases, and closes while
  // she speaks so she never transcribes her own voice.
  useEffect(() => {
    if (!handsFree) {
      stop();
      return;
    }
    if (speaking) stop();
    else start();
  }, [handsFree, speaking, start, stop]);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, [contenteditable], [cmdk-root]")) return;
      event.preventDefault();
      start();
    };
    const up = (event: KeyboardEvent) => {
      if (event.code === "Space") stop();
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [start, stop]);

  return (
    <aside className="flex min-h-0 w-full flex-1 flex-col bg-panel">
      <div className="flex h-12 flex-none items-center justify-between border-b border-border-soft px-4">
        <span className="label !text-foreground/85">transcript</span>
        <span className="flex h-3 items-end gap-[3px]" aria-label={thinking ? "thinking" : "idle"}>
          {[0, 1, 2, 3].map((bar) => (
            <span
              key={bar}
              className={`w-[2px] bg-voice ${thinking ? "animate-[thinking_1s_ease-in-out_infinite]" : "opacity-25"}`}
              style={{ height: 12, animationDelay: `${bar * 0.15}s` }}
            />
          ))}
        </span>
      </div>

      <div ref={viewport} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loadingMore && <div className="label pb-2 text-center">loading earlier…</div>}
        <div className="space-y-4">
          {rows.map((row) =>
            row.type === "quiet" ? (
              <QuietCluster key={row.thoughts[0].ts} thoughts={row.thoughts} onOpen={setReceipt} />
            ) : (
              <Entry key={thoughtKey(row.thought)} thought={row.thought} onOpen={setReceipt} />
            ),
          )}
          {partial !== null && (
            <div>
              <div className="label mb-1">now&nbsp; you</div>
              <p className="text-[13.5px] leading-relaxed text-foreground">
                {partial || <span className="text-muted-foreground">listening…</span>}
                <span className="ml-0.5 inline-block h-3.5 w-[2px] animate-[caret_.8s_step-end_infinite] bg-voice align-middle" />
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-none items-center gap-2 border-t border-border-soft p-3">
        <Button
          variant="outline"
          size="icon"
          onClick={() => setHandsFree((value) => !value)}
          aria-pressed={handsFree}
          aria-label="hands-free conversation"
          title="hands-free: mic stays open"
          className={`h-9 w-9 flex-none rounded-none font-mono text-[13px] transition-colors ${
            handsFree
              ? "border-voice bg-voice/15 text-voice hover:bg-voice/20 hover:text-voice"
              : "border-border-soft text-muted-foreground hover:text-foreground"
          }`}
        >
          ∞
        </Button>
        <Button
          variant="outline"
          size="icon"
          onPointerDown={start}
          onPointerUp={stop}
          onPointerLeave={stop}
          aria-label="hold to talk"
          className={`h-9 w-9 flex-none rounded-none transition-colors ${
            partial !== null
              ? "border-voice bg-voice text-white hover:bg-voice"
              : "border-voice/60 text-voice hover:bg-voice/10 hover:text-voice"
          }`}
        >
          <MicIcon />
        </Button>
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") send(draft);
          }}
          placeholder="> talk to vedi"
          aria-label="type to vedi"
          className="h-9 min-w-0 flex-1 rounded-none border-border-soft bg-transparent px-3 font-mono text-[12px] placeholder:text-muted-foreground/70"
        />
      </div>
      <div className="label flex flex-none justify-between px-4 pb-3 pt-1">
        <span>space&nbsp;hold&nbsp;to&nbsp;talk</span>
        <span>⌘k&nbsp;search&nbsp;·&nbsp;b&nbsp;brain</span>
      </div>

      <ReceiptSheet thought={receipt} onClose={() => setReceipt(null)} />
    </aside>
  );
}

function Entry({ thought, onOpen }: { thought: Thought; onOpen: (thought: Thought) => void }) {
  const question =
    thought.question ??
    (thought.kind === "user" && thought.why.startsWith("asked: ") ? thought.why.slice(7) : null);
  const spoke = thought.action === "speak" || thought.action === "reply";
  return (
    <div className="group">
      {question && (
        <div className="mb-3">
          <div className="label mb-1">{clock(thought.ts)}&nbsp; you</div>
          <p className="text-[13.5px] leading-relaxed text-muted-foreground">{question}</p>
        </div>
      )}
      <Button
        variant="ghost"
        onClick={() => onOpen(thought)}
        aria-label="open receipt"
        className="block h-auto w-full rounded-none p-0 text-left font-normal hover:bg-transparent"
      >
        <div className="label mb-1 flex items-baseline gap-2">
          <span>{clock(thought.ts)}</span>
          <span className={spoke ? "!text-voice" : thought.action === "note" ? "!text-amber-400/90" : ""}>
            {thought.action === "reply" ? "vedi" : thought.action}
          </span>
          {thought.delivery && spoke && <span className="normal-case tracking-normal">· {thought.delivery}</span>}
          <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">receipt ›</span>
        </div>
        {thought.action === "note" ? (
          <p className="whitespace-normal text-[12.5px] italic leading-relaxed text-muted-foreground">{thought.text}</p>
        ) : (
          <p className="whitespace-normal text-[13.5px] leading-relaxed text-foreground">{thought.text}</p>
        )}
      </Button>
    </div>
  );
}

function QuietCluster({
  thoughts,
  onOpen,
}: {
  thoughts: Thought[];
  onOpen: (thought: Thought) => void;
}) {
  const range = `${clock(thoughts[0].ts).slice(0, 5)}–${clock(thoughts[thoughts.length - 1].ts).slice(0, 5)}`;
  return (
    <Collapsible>
      <CollapsibleTrigger className="label flex w-full items-center gap-2 py-0.5 text-left hover:!text-foreground">
        <span className="flex items-end gap-[3px]" aria-hidden>
          {thoughts.slice(0, 12).map((tick, index) => (
            <span key={`${tick.ts}-${index}`} className="inline-block h-[9px] w-[2px] bg-muted-foreground/55" />
          ))}
        </span>
        <span>
          {thoughts.length} quiet&nbsp; {range}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5 space-y-1.5 border-l border-border-soft pl-3">
        {thoughts.map((thought) => (
          <Button
            key={thought.ts}
            variant="ghost"
            onClick={() => onOpen(thought)}
            className="block h-auto w-full whitespace-normal rounded-none p-0 text-left font-mono text-[10.5px] font-normal leading-relaxed text-muted-foreground hover:bg-transparent hover:text-foreground"
          >
            {clock(thought.ts)}&nbsp; {thought.why}
          </Button>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Consecutive ignores fold into one cluster row. */
function cluster(thoughts: Thought[]): Row[] {
  const rows: Row[] = [];
  for (const thought of thoughts) {
    if (thought.action === "ignore") {
      const last = rows[rows.length - 1];
      if (last?.type === "quiet") last.thoughts.push(thought);
      else rows.push({ type: "quiet", thoughts: [thought] });
    } else {
      rows.push({ type: "thought", thought });
    }
  }
  return rows;
}

type Recognition = {
  start(): void;
  stop(): void;
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult:
    | ((event: {
        results: {
          [i: number]: { [j: number]: { transcript: string }; isFinal: boolean };
          length: number;
        };
      }) => void)
    | null;
  onend: (() => void) | null;
};

/** Chrome's streaming recognition. Hold-to-talk by default; with the
 * hands-free ref set, each phrase auto-sends and the mic reopens. */
function useSpeech(
  setPartial: (value: string | null) => void,
  send: (text: string) => void,
  handsFreeRef?: React.RefObject<boolean>,
  speakingRef?: React.RefObject<boolean>,
) {
  const recognition = useRef<Recognition | null>(null);
  const transcript = useRef("");
  const sentUpTo = useRef(0);
  const active = useRef(false);

  const start = useCallback(() => {
    if (active.current) return;
    const Ctor = (window as unknown as { webkitSpeechRecognition?: new () => Recognition })
      .webkitSpeechRecognition;
    if (!Ctor) return;
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = "en-US";
    transcript.current = "";
    sentUpTo.current = 0;
    rec.onresult = (event) => {
      // Finalized phrases send immediately (the pause IS the send);
      // the still-forming tail stays on screen as the partial.
      let interim = "";
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          if (i >= sentUpTo.current) {
            const phrase = result[0].transcript.trim();
            if (phrase) send(phrase);
            sentUpTo.current = i + 1;
          }
        } else {
          interim += result[0].transcript;
        }
      }
      transcript.current = interim;
      setPartial(interim);
    };
    rec.onend = () => {
      if (!active.current) return;
      active.current = false;
      setPartial(null);
      if (transcript.current.trim()) send(transcript.current);
      if (handsFreeRef?.current && !speakingRef?.current) {
        setTimeout(() => {
          if (handsFreeRef.current && !speakingRef?.current && !active.current) startRef.current?.();
        }, 300);
      }
    };
    recognition.current = rec;
    active.current = true;
    setPartial("");
    rec.start();
  }, [setPartial, send]);

  const stop = useCallback(() => {
    if (!active.current) return;
    active.current = false;
    setPartial(null);
    recognition.current?.stop();
    if (transcript.current.trim()) send(transcript.current);
  }, [send, setPartial]);

  const startRef = useRef<(() => void) | null>(null);
  startRef.current = start;

  return { start, stop };
}

function MicIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="9" y="3" width="6" height="11" fill="currentColor" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}
