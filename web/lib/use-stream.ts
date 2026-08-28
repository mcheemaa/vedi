"use client";

import { useEffect } from "react";

export type StreamEvent =
  | {
      type: "thought";
      turn_id?: string;
      ts: string;
      kind: string;
      action: string;
      text: string;
      why: string;
      delivery?: string;
      question?: string;
      latency_ms: number;
    }
  | { type: "frame"; frameId: string; ts: string }
  | { type: "speaking"; on: boolean };

/** Live push from the Brain over SSE: thoughts and frames arrive the
 * instant they exist. EventSource reconnects on its own; polling
 * remains the backstop for anything missed while disconnected. */
export function useStream(onEvent: (event: StreamEvent) => void): void {
  useEffect(() => {
    const source = new EventSource("http://127.0.0.1:8484/stream");
    source.onmessage = (message) => {
      try {
        onEvent(JSON.parse(message.data) as StreamEvent);
      } catch {
        // malformed line; the poll backstop covers it
      }
    };
    return () => source.close();
  }, [onEvent]);
}
