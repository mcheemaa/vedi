/** In-process pub/sub feeding the surface's live stream: the Brain
 * knows the instant a thought lands or a frame stores, so the page
 * hears about it then, not a poll later. */
type Subscriber = (line: string) => void;

const subscribers = new Set<Subscriber>();

export function publish(type: string, data: Record<string, unknown>): void {
  const line = `data: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const send of subscribers) {
    try {
      send(line);
    } catch {
      subscribers.delete(send);
    }
  }
}

export function sseResponse(): Response {
  let send: Subscriber;
  let heartbeat: ReturnType<typeof setInterval>;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      send = (line) => controller.enqueue(encoder.encode(line));
      subscribers.add(send);
      send(": connected\n\n");
      // Under Bun's 10s default idle timeout; keeps the stream alive.
      heartbeat = setInterval(() => send(": beat\n\n"), 5000);
    },
    cancel() {
      subscribers.delete(send);
      clearInterval(heartbeat);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
