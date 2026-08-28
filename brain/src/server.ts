import { publish, sseResponse } from "./bus";
import { Policy } from "./context/policy";
import { buildVisionState } from "./context/vision-state";
import { loadEnv } from "./env";
import { FrameStore, type FrameMeta } from "./frame-store";
import { loadDefinition } from "./loop/definition";
import { Loop, type PerceptEvent } from "./loop/loop";
import { EmbedClient } from "./model/embed-client";
import { makeModel, makeVoice } from "./model/slot";
import { Narrator } from "./narrator";
import { startDreamer } from "./dreamer";
import { ClickHouse } from "./store/clickhouse";
import { Deep } from "./store/deep";
import { Digests, localDay } from "./store/digests";
import { Facts } from "./store/facts";
import { Traces } from "./store/traces";
import { Watches } from "./store/watches";
import { makeLookTool } from "./tools/look";
import { makeRememberTool } from "./tools/remember";
import { makeWatchTools } from "./tools/watch";
import { startWatcher } from "./watcher";
import { makeRecallTool } from "./tools/recall";
import { makeSearchMemoryTool } from "./tools/search-memory";
import { Say } from "./voice/say";

const { values: env, directory } = loadEnv();
const store = FrameStore.fromEnv(env, directory);
const port = Number(env.BRAIN_PORT ?? 8484);

const ch = new ClickHouse(env);
const traces = new Traces(ch);
await traces.ensureTable();
const facts = new Facts(ch);
await facts.ensureTable();
const watches = new Watches(ch);
await watches.ensureTable();
const deep = new Deep(ch);
await deep.ensureTable();
const digests = new Digests(ch);
await digests.ensureTable();

const definition = loadDefinition(directory);
const { model, id: modelId } = makeModel({ ...env, VEDI_MODEL: env.VEDI_MODEL ?? definition.model });
const policy = new Policy();
const say = new Say(makeVoice(env), env.VEDI_VOICE);
const embedClient = new EmbedClient(directory);
const registry = {
  recall: makeRecallTool(ch),
  search_memory: makeSearchMemoryTool(ch, embedClient),
  remember: makeRememberTool(facts),
  look: makeLookTool(store, makeModel({ ...env, VEDI_MODEL: env.VEDI_LOOK_MODEL ?? modelId }).model),
  ...makeWatchTools(watches, embedClient),
};
const tools = Object.fromEntries(
  definition.tools.map((name) => {
    const tool = registry[name as keyof typeof registry];
    if (!tool) throw new Error(`vedi.md lists unknown tool "${name}"`);
    return [name, tool];
  }),
);
const loop = new Loop({ model, modelId, system: definition.system, tools, ch, traces, facts, digests, policy, say });
await loop.boot();
setInterval(() => loop.onHeartbeat(), 60_000);
startWatcher(ch, watches, loop);
const dreamerDef = loadDefinition(directory, "dreamer");
const dreamModelId = env.VEDI_DREAM_MODEL ?? dreamerDef.model;
startDreamer({
  ch,
  deep,
  digests,
  facts,
  frames: store,
  model: makeModel({ ...env, VEDI_MODEL: dreamModelId }).model,
  modelId: dreamModelId,
  system: dreamerDef.system,
});
const narratorDef = loadDefinition(directory, "narrator");
const narratorModelId = env.VEDI_NARRATOR_MODEL ?? narratorDef.model;
const narrator = new Narrator({
  ch,
  digests,
  facts,
  model: makeModel({ ...env, VEDI_MODEL: narratorModelId }).model,
  modelId: narratorModelId,
  system: narratorDef.system,
});
narrator.start();

function meta(req: Request): FrameMeta {
  const need = (h: string): string => {
    const value = req.headers.get(h);
    if (!value) throw new Error(`missing header ${h}`);
    return value;
  };
  return {
    frameId: need("x-frame-id"),
    ts: need("x-frame-ts"),
    camera: need("x-frame-camera"),
    width: Number(need("x-frame-width")),
    height: Number(need("x-frame-height")),
  };
}

const server = Bun.serve({
  port,
  hostname: "127.0.0.1",
  idleTimeout: 120,
  routes: {
    "/health": async () =>
      Response.json({
        frames: await store.health(),
        model: modelId,
        policy: policy.current(),
        loop: loop.stats(),
        dreamer: await deep.counts(),
      }),
    "/frames": {
      POST: async (req) => {
        try {
          const m = meta(req);
          const jpeg = Buffer.from(await req.arrayBuffer());
          await store.store(m, jpeg);
          publish("frame", { frameId: m.frameId, ts: m.ts });
          console.log(`frame ${m.frameId.slice(0, 8)}  ${m.width}x${m.height}  ${(jpeg.length / 1024).toFixed(0)}KB  stored`);
          return new Response("ok");
        } catch (error) {
          console.error("frame store failed:", error);
          return new Response(String(error), { status: 500 });
        }
      },
    },
    "/percepts": {
      POST: async (req) => {
        try {
          const event = (await req.json()) as PerceptEvent;
          if (!event.kind || !event.frame_id) return new Response("kind and frame_id required", { status: 400 });
          loop.onPercept(event);
          return new Response("ok");
        } catch (error) {
          return new Response(String(error), { status: 400 });
        }
      },
    },
    "/say": {
      POST: async (req) => {
        try {
          const { text } = (await req.json()) as { text?: string };
          if (!text) return new Response("text required", { status: 400 });
          void narrator.foldIfStale().catch(() => {});
          const reply = await loop.onUser(text);
          return Response.json({ reply });
        } catch (error) {
          return new Response(String(error), { status: 500 });
        }
      },
    },
    "/stream": () => sseResponse(),
    "/fold": {
      POST: async () => {
        await narrator.fold(localDay());
        return Response.json(await digests.forDay(localDay()));
      },
    },
    "/frames/recent": async () =>
      Response.json(await store.recent(30), {
        headers: { "Access-Control-Allow-Origin": "*" },
      }),
    "/frames/:id": async (req: Bun.BunRequest<"/frames/:id">) => {
      const jpeg = await store.fetch(req.params.id);
      if (!jpeg) return new Response("not found", { status: 404 });
      return new Response(new Uint8Array(jpeg), {
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "public, max-age=3600, immutable",
          "Access-Control-Allow-Origin": "*",
        },
      });
    },
    "/embed": async (req) => {
      const text = new URL(req.url).searchParams.get("text");
      if (!text) return new Response("text required", { status: 400 });
      const embedding = await embedClient.embed(text);
      if (!embedding) return new Response("embed unavailable", { status: 503 });
      return Response.json(
        { embedding },
        { headers: { "Access-Control-Allow-Origin": "*" } },
      );
    },
    "/vision": async () =>
      Response.json({
        vision: `${await facts.block()}\n${await digests.block(localDay())}\n${await buildVisionState(ch)}`.trim(),
        policy: policy.block(),
      }),
    "/policy": {
      GET: () => Response.json(policy.current()),
      POST: async (req) => {
        const { mode, note } = (await req.json()) as { mode?: "normal" | "quiet"; note?: string };
        if (mode !== "normal" && mode !== "quiet") return new Response("mode must be normal|quiet", { status: 400 });
        policy.set(mode, note ?? "");
        return Response.json(policy.current());
      },
    },
  },
});

console.log(`vedi-brain listening on http://127.0.0.1:${server.port}  model=${modelId}  agent=${definition.name}`);
