// ---------------------------------------------------------------------------
// WebLLM integration – in-browser LLM for POI snippet synthesis
// Uses @mlc-ai/web-llm with Qwen2.5-1.5B-Instruct (q4f16_1-MLC)
// Fallback: if no WebGPU, returns null (raw snippets shown without synthesis)
// ---------------------------------------------------------------------------

import type { SearchSnippet, TargetLanguage, WebsitePreview, PoiCategory, OpeningHoursEntry } from "../../types";
import { dlog } from "../debug-log";
import { getEnrichmentContract } from "../poi-config";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Compact structured output from LLM synthesis (Google Maps style) */
export interface LlmSynthesis {
  rating: number | null;
  reviewCount: number | null;
  /** Structured opening hours table */
  hours: OpeningHoursEntry[] | null;
  /** Flat hours string for backward compat & export (derived from hours table) */
  hoursFlat: string | null;
  /** One-sentence description in target language (merges what was previously summary + specialty) */
  description: string | null;
  /** One-sentence review/verdict in target language */
  review: string | null;
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
// Contract-aware prompt sections (WS8)
// ---------------------------------------------------------------------------

/**
 * Build a prompt block from a category contract.
 * Injected into the system prompt to give the LLM category-specific guidance.
 * (WS8: category-specific LLM prompt hardening)
 */
function buildContractBlock(
  category: string,
  priorities: readonly string[],
  valuableSignals: readonly string[],
  bannedPatterns: readonly string[],
): string {
  const priorityList = priorities.map((p, i) => `  ${i + 1}. ${p}`).join("\n");
  const signalList = valuableSignals.slice(0, 5).map((s) => `  - ${s}`).join("\n");
  const bannedList = bannedPatterns.map((b) => `  - ${b}`).join("\n");

  return `
Category-specific instructions for "${category}":

Priority signals for description and review:
${priorityList}

Valuable signals to include when found:
${signalList}

NEVER include in your output:
${bannedList}`;
}

// ---------------------------------------------------------------------------
// Synthesis prompt
// ---------------------------------------------------------------------------

/**
 * Build the system prompt for POI synthesis.
 * The LLM extracts structured info from raw search snippets.
 * WS8: category-specific prompt hardening using contracts.
 * @param targetLanguage - language for the translatedSummary field
 * @param category - POI category for contract-aware prompt sections
 * Exported for testing (WS8).
 */
export function buildSystemPrompt(targetLanguage: TargetLanguage, category?: string): string {
  const langName = targetLanguage === "fr" ? "French" : "English";

  // WS8: inject contract-specific instructions if available
  const contract = category ? getEnrichmentContract(category as PoiCategory) : null;
  const contractBlock = contract ? buildContractBlock(contract.category, contract.priorities, contract.valuableSignals, contract.bannedPatterns) : "";

  // Price emphasis for commercial categories
  const commercialCategories = new Set(["Restaurant or Bar", "Food shop", "Sleeping place", "Gears"]);
  const priceBlock = category && commercialCategories.has(category)
    ? `\n- "priceLevel": IMPORTANT for this category. Look for price indicators: €€/$$$ symbols, "inexpensive"/"moderate"/"expensive", explicit prices (15€, $20), Booking/Airbnb tariffs. 1=budget, 2=moderate, 3=upscale, 4=luxury.`
    : "";

  return `You are a travel assistant. Given web search snippets about a place, extract a compact summary for a cyclist.

Respond ONLY with a JSON object (no markdown, no backticks, no explanation):
{
  "rating": <number 1-5 or null>,
  "reviewCount": <number or null>,
  "hours": [{"day":"Mon-Fri","open":"08:00","close":"19:00"},{"day":"Sat","open":"09:00","close":"13:00"},{"day":"Sun","open":"closed","close":null}],
  "description": <one sentence in ${langName}, what the place is and why it matters for a cyclist, or null>,
  "review": <one sentence in ${langName}, synthesis of reviews/reputation, or null>,
  "priceLevel": <number 1-4 or null, 1=cheap 4=expensive>
}

Rules:
- Extract ONLY what the snippets say. Do NOT invent or guess.
- If a field cannot be determined, use null. Never guess.
- "rating": only from explicit ratings (e.g. "4.2/5"). Do not estimate from sentiment.
- "reviewCount": only from explicit counts (e.g. "238 reviews").
- "hours": structured table. Each entry has "day" (e.g. "Mon", "Mon-Fri", "Sat-Sun"), "open" (time or "closed"), "close" (time or null if closed). Use null for the whole field if no hours found.
- "description": ONE sentence in ${langName}. Include type/specialty if known (e.g. "Italian restaurant with terrace, good for resupply"). Merge vibe and utility.
- "review": ONE sentence in ${langName}. Summarize reputation: rating, review sentiment, key strengths or caveats. If sources disagree, say so.${priceBlock}
- Be maximally concise. No filler. Prefer null over uncertain data.
${contractBlock}`;
}

/**
 * Build the user prompt with POI context and search snippets.
 */
function buildUserPrompt(
  poiName: string,
  category: string,
  snippets: SearchSnippet[],
  websitePreview?: WebsitePreview | null,
): string {
  const snippetText = snippets
    .map(
      (s, i) =>
        `[${i + 1}] ${s.title}\n${s.content}\n(source: ${s.engine})`,
    )
    .join("\n\n");

  const websiteText = websitePreview
    ? `\n\nOfficial website preview:\nTitle: ${websitePreview.title ?? "n/a"}\nDescription: ${websitePreview.description ?? "n/a"}\nExcerpt: ${websitePreview.excerpt ?? "n/a"}\nSource URL: ${websitePreview.finalUrl}`
    : "";

  return `Place: "${poiName}" (${category})

Web search results:
${snippetText}

${websiteText}

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
  websitePreview?: WebsitePreview | null,
): Promise<LlmSynthesis | null> {
  if (!engineReady || !engineInstance) return null;
  if (snippets.length === 0) return null;

  try {
    const log = dlog("llm");
    const response = await engineInstance.chat.completions.create({
      messages: [
        { role: "system", content: buildSystemPrompt(targetLanguage, category) },
        {
          role: "user",
          content: buildUserPrompt(poiName, category, snippets, websitePreview),
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
      description: parsed?.description?.slice(0, 100),
      review: parsed?.review?.slice(0, 100),
      hoursEntries: parsed?.hours?.length ?? 0,
    });

    return parsed;
  } catch (err) {
    console.error("[WebLLM] Synthesis failed:", err);
    return null;
  }
}

/**
 * Parse the LLM JSON output (compact format), tolerating minor formatting issues.
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

    // Parse structured hours
    const hours = parseHoursField(parsed.hours);
    const hoursFlat = hours ? flattenHours(hours) : null;

    // Validate and coerce types
    return {
      rating: typeof parsed.rating === "number" && parsed.rating >= 1 && parsed.rating <= 5
        ? Math.round(parsed.rating * 10) / 10
        : null,
      reviewCount: typeof parsed.reviewCount === "number" && parsed.reviewCount >= 0
        ? Math.round(parsed.reviewCount)
        : null,
      hours,
      hoursFlat,
      description: typeof parsed.description === "string" && parsed.description.length > 0
        ? parsed.description.slice(0, 300)
        : null,
      review: typeof parsed.review === "string" && parsed.review.length > 0
        ? parsed.review.slice(0, 300)
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

// ---------------------------------------------------------------------------
// Hours parsing helpers
// ---------------------------------------------------------------------------

/**
 * Parse the hours field from LLM output.
 * Accepts either:
 * - An array of OpeningHoursEntry objects (new format)
 * - A string (legacy format) — converted to a single entry
 * Returns null if invalid.
 */
function parseHoursField(raw: unknown): OpeningHoursEntry[] | null {
  if (raw == null) return null;

  // New format: array of {day, open, close}
  if (Array.isArray(raw)) {
    const entries: OpeningHoursEntry[] = [];
    for (const item of raw) {
      if (typeof item !== "object" || item === null) continue;
      const entry = item as Record<string, unknown>;
      const day = typeof entry.day === "string" ? entry.day.trim() : null;
      const open = typeof entry.open === "string" ? entry.open.trim() : null;
      if (!day || !open) continue;
      entries.push({
        day,
        open,
        close: typeof entry.close === "string" ? entry.close.trim() : null,
      });
    }
    return entries.length > 0 ? entries : null;
  }

  // Legacy fallback: string → single entry with full text
  if (typeof raw === "string" && raw.trim().length > 0) {
    return [{ day: "All", open: raw.trim(), close: null }];
  }

  return null;
}

/**
 * Flatten structured hours to a human-readable string for exports and backward compat.
 * e.g. [{ day: "Mon-Fri", open: "08:00", close: "19:00" }] → "Mon-Fri: 08:00-19:00"
 */
export function flattenHours(entries: OpeningHoursEntry[]): string {
  return entries
    .map((e) => {
      if (e.open.toLowerCase() === "closed") return `${e.day}: closed`;
      if (e.close) return `${e.day}: ${e.open}-${e.close}`;
      return `${e.day}: ${e.open}`;
    })
    .join("; ");
}
