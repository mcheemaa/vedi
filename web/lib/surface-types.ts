export type Thought = {
  turn_id?: string;
  ts: string;
  kind: string;
  action: string;
  text: string;
  why: string;
  delivery?: string;
  question?: string;
  evidence?: string[];
  latency_ms: number;
  input_tokens?: number;
  output_tokens?: number;
  model?: string;
};

/** One turn, one identity: the Brain's turn_id when present (it rides
 * both the live broadcast and the ClickHouse row), timestamp only as
 * a legacy fallback so the two channels can never render twice. */
export function thoughtKey(thought: Pick<Thought, "turn_id" | "ts" | "action">): string {
  return thought.turn_id ?? `${thought.ts}|${thought.action}`;
}

export type Pulse = {
  now: number;
  brainUp: boolean;
  eyesOpen: boolean;
  dreamer?: { dreamt: string; pending: string } | null;
  framesStored?: number;
  vision: string;
  policy: string;
  regions: {
    region_id: number;
    label: string;
    status: string;
    member_count: string;
    last_seen: string;
  }[];
  thoughts: Thought[];
  spark: number[];
  silences: number;
  keyframes: number;
};

export type CloudPoint = {
  id: string;
  ts: string;
  region: number;
  keyframe: boolean;
  p: [number, number, number];
};

export type CloudAnchor = {
  region: number;
  label: string;
  p: [number, number, number];
};

export type CloudData = {
  points: CloudPoint[];
  latest: string | null;
  anchors: CloudAnchor[];
};

export type SearchHit = {
  frame_id: string;
  ts: string;
  region_id: number;
  keyframe: number;
  sim: number;
  caption: string;
  nearest_frame?: string;
};

export const BRAIN_URL = "http://127.0.0.1:8484";

export function clock(clickhouseTs: string): string {
  const date = new Date(`${clickhouseTs.replace(" ", "T")}Z`);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}
