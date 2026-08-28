import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel, SpeechModel } from "ai";
import type { VoiceConfig } from "../voice/say";

/** The swappable brain (law 4): provider and model are configuration.
 * Default is the fastest tier Cheema picked; VEDI_MODEL swaps to
 * terra/sol or another provider's id without touching callers. */
export const DEFAULT_MODEL = "gpt-5.6-luna";
export const DEFAULT_TTS_MODEL = "gpt-4o-mini-tts-2025-12-15";
export const DEFAULT_TTS_VOICE = "coral";

export function makeModel(env: Record<string, string>): { model: LanguageModel; id: string } {
  const id = env.VEDI_MODEL ?? DEFAULT_MODEL;
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  return { model: openai(id), id };
}

/** VEDI_TTS=say opts back into the robotic fallback voice. */
export function makeVoice(env: Record<string, string>): VoiceConfig | null {
  if (env.VEDI_TTS === "say" || !env.OPENAI_API_KEY) return null;
  const openai = createOpenAI({ apiKey: env.OPENAI_API_KEY });
  const modelId = env.VEDI_TTS ?? DEFAULT_TTS_MODEL;
  return {
    apiKey: env.OPENAI_API_KEY,
    modelId,
    model: openai.speech(modelId),
    voice: env.VEDI_TTS_VOICE ?? DEFAULT_TTS_VOICE,
  };
}
