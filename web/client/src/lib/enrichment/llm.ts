// ---------------------------------------------------------------------------
// WebLLM integration – in-browser LLM for POI snippet synthesis
// Uses @mlc-ai/web-llm with Qwen2.5-1.5B-Instruct (q4f16_1-MLC)
// Fallback: if no WebGPU, returns null (raw snippets shown without synthesis)
// ---------------------------------------------------------------------------

import type { SearchSnippet, TargetLanguage } from "../../types";
import { dlog } from "../debug-log";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Structured output from LLM synthesis */
export interface LlmSynthesis {
  rating: number | null;
  reviewCount: number | null;
  hours: string | null;
  /** Summary in source snippet language */
  summary: string | null;
  /** Summary rewritten in the user's target language (same as summary if source already matches) */
  translatedSummary: string | null;
  specialty: string | null;
  priceLevel: number | null;
}

/** Progress callback for model loading */
export type ModelLoadProgressCallback = (progress: number) => void;

// ---------------------------------------------------------------------------
// WebGPU detection
// ---------------------------------------------------------------------------

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

// ---------------------------------------------------------------------------
// LLM Engine singleton
// We lazy-load @mlc-ai/web-llm to keep the main bundle small.
// The engine is a singleton: one model loaded at a time.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let engineInstance: any = null;
let engineReady = false;

const MODEL_ID = "Qwen2.5-1.5B-Instruct-q4f16_1-MLC";

/**
 * Initialize the WebLLM engine and download/cache the model.
 * This can take 30s-2min on first load (1.6GB download).
 * Subsequent loads use the browser cache (~2s).
 */
export async function initEngine(
  onProgress?: ModelLoadProgressCallback,
): Promise<boolean> {
  if (engineReady && engineInstance) return true;

  if (!isWebGpuAvailable()) {
    return false;
  }

  try {
    // Dynamic import to keep main bundle small
    const webllm = await import("@mlc-ai/web-llm");

    engineInstance = await webllm.CreateMLCEngine(MODEL_ID, {
      initProgressCallback: (report: { progress: number; text: string }) => {
        onProgress?.(report.progress);
      },
    });

    engineReady = true;
    return true;
  } catch (err) {
    console.error("[WebLLM] Engine init failed:", err);
    engineReady = false;
    engineInstance = null;
    return false;
  }
}

/**
 * Check if the engine is ready for inference.
 */
export function isEngineReady(): boolean {
  return engineReady && engineInstance != null;
}

/**
 * Unload the engine to free VRAM.
 */
export async function unloadEngine(): Promise<void> {
  if (engineInstance) {
    try {
      await engineInstance.unload();
    } catch {
      // Ignore unload errors
    }
    engineInstance = null;
    engineReady = false;
  }
}

// ---------------------------------------------------------------------------
// Synthesis prompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for POI synthesis.
 * The LLM extracts structured info from raw search snippets.
 * @param targetLanguage - language for the translatedSummary field
 */
function buildSystemPrompt(targetLanguage: TargetLanguage): string {
  const langName = targetLanguage === "fr" ? "French" : "English";
  return `You are a travel assistant. Given web search snippets about a place, extract useful information for a cyclist.

Respond ONLY with a JSON object (no markdown, no backticks, no explanation):
{
  "rating": <number 1-5 or null if not mentioned in snippets>,
  "reviewCount": <number or null if not mentioned>,
  "hours": <string or null, e.g. "Mon-Fri 8:00-19:00, Sat 9:00-13:00">,
  "summary": <string in the original snippet language, 2-3 sentences max, useful for a cyclist, or null>,
  "translatedSummary": <same summary rewritten in ${langName}, 2-3 sentences max, or null if summary is null>,
  "specialty": <string, type/cuisine/specialty, or null>,
  "priceLevel": <number 1-4 or null, 1=cheap 4=expensive>
}

Rules:
- Extract ONLY what the snippets actually say. Do NOT invent or guess.
- If a field cannot be determined from snippets, ALWAYS use null. Never guess.
- For rating: only extract if an explicit rating (e.g. "4.2/5", "4 stars") is mentioned. Do not estimate from sentiment.
- For reviewCount: only extract if an explicit count is mentioned (e.g. "238 reviews"). Do not estimate.
- "summary" must stay in the original language of the snippets (French, English, Italian, etc.).
- "translatedSummary" must be written in ${langName}. If the snippets are already in ${langName}, copy the summary as-is.
- Summary should mention: vibe, quality, cyclist-friendliness if mentioned.
- Be concise. Prefer null over uncertain data.
- When snippets are vague or contradictory, say so explicitly (e.g. "Limited information available", "Sources disagree"). Never fill gaps with plausible-sounding invented detail.`;
}

/**
 * Build the user prompt with POI context and search snippets.
 */
function buildUserPrompt(
  poiName: string,
  category: string,
  snippets: SearchSnippet[],
): string {
  const snippetText = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n${s.content}\n(source: ${s.engine})`,
    )
    .join("\n\n");

  return `Place: "${poiName}" (${category})

Web search results:
${snippetText}

Extract the JSON:`;
}

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

/** Max tokens for LLM response */
const MAX_TOKENS = 300;

/** Temperature for synthesis (low = more factual) */
const TEMPERATURE = 0.1;

/**
 * Synthesize search snippets into structured enrichment data using the in-browser LLM.
 * Returns null if engine is not ready or synthesis fails.
 * @param targetLanguage - language for the translatedSummary output
 */
export async function synthesize(
  poiName: string,
  category: string,
  snippets: SearchSnippet[],
  targetLanguage: TargetLanguage = "en",
): Promise<LlmSynthesis | null> {
  if (!engineReady || !engineInstance) return null;
  if (snippets.length === 0) return null;

  try {
    const log = dlog("llm");
    const response = await engineInstance.chat.completions.create({
      messages: [
        { role: "system", content: buildSystemPrompt(targetLanguage) },
        {
          role: "user",
          content: buildUserPrompt(poiName, category, snippets),
        },
      ],
      max_tokens: MAX_TOKENS,
      temperature: TEMPERATURE,
    });

    const text = response.choices?.[0]?.message?.content?.trim();
    if (!text) return null;

    const parsed = parseLlmOutput(text);

    // Debug: log LLM synthesis result
    log.info(`LLM synthesis for "${poiName}"`, {
      rawOutput: text.slice(0, 300),
      rating: parsed?.rating,
      summary: parsed?.summary?.slice(0, 100),
      translatedSummary: parsed?.translatedSummary?.slice(0, 100),
      specialty: parsed?.specialty,
      hours: parsed?.hours,
    });

    return parsed;
  } catch (err) {
    console.error("[WebLLM] Synthesis failed:", err);
    return null;
  }
}

/**
 * Parse the LLM JSON output, tolerating minor formatting issues.
 * Exported for testing.
 */
export function parseLlmOutput(text: string): LlmSynthesis | null {
  try {
    // Strip markdown code block wrapper if present
    let cleaned = text;
    if (cleaned.startsWith("```")) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }

    // Try to find JSON object in the text
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and coerce types
    return {
      rating: typeof parsed.rating === "number" && parsed.rating >= 1 && parsed.rating <= 5
        ? Math.round(parsed.rating * 10) / 10
        : null,
      reviewCount: typeof parsed.reviewCount === "number" && parsed.reviewCount >= 0
        ? Math.round(parsed.reviewCount)
        : null,
      hours: typeof parsed.hours === "string" && parsed.hours.length > 0
        ? parsed.hours
        : null,
      summary: typeof parsed.summary === "string" && parsed.summary.length > 0
        ? parsed.summary.slice(0, 500)
        : null,
      translatedSummary: typeof parsed.translatedSummary === "string" && parsed.translatedSummary.length > 0
        ? parsed.translatedSummary.slice(0, 500)
        : null,
      specialty: typeof parsed.specialty === "string" && parsed.specialty.length > 0
        ? parsed.specialty.slice(0, 100)
        : null,
      priceLevel: typeof parsed.priceLevel === "number" && parsed.priceLevel >= 1 && parsed.priceLevel <= 4
        ? Math.round(parsed.priceLevel)
        : null,
    };
  } catch {
    console.warn("[WebLLM] Failed to parse LLM output:", text.slice(0, 200));
    return null;
  }
}
