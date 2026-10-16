// WebLLM integration: in-browser LLM for POI snippet synthesis
// Uses @mlc-ai/web-llm with Qwen2.5-3B-Instruct (q4f16_1-MLC)
// Fallback: if no WebGPU, returns null (raw snippets shown without synthesis)

import type { ChatCompletion, MLCEngine } from "@mlc-ai/web-llm";
import type {
  BookingStatus,
  OpeningHoursEntry,
  PoiCategory,
  SearchSnippet,
  TargetLanguage,
  WebsitePreview,
} from "../../types";
import { dlog } from "../debug-log";
import { getEnrichabilityPolicy, getEnrichmentContract } from "../poi-config";

// --- Types ---

/** Compact structured output from LLM synthesis (Google Maps style) */
export interface LlmSynthesis {
  rating: number | null;
  reviewCount: number | null;
  /** Structured opening hours table */
  hours: OpeningHoursEntry[] | null;
  /** Flat hours string for export (derived from hours table) */
  hoursFlat: string | null;
  /** One-sentence description in target language */
  description: string | null;
  /** One-sentence review/verdict in target language */
  review: string | null;
  priceLevel: number | null;
  /** Opening period for seasonal places, as stated ("6 June to 28 September") */
  season?: string | null;
  /** Prices with unit and currency, as stated */
  priceNote?: string | null;
  /** Reservation needed, only when a snippet says so */
  booking?: BookingStatus | null;
  repaired?: boolean;
  repairReason?: string | null;
}

const MAX_SEASON_CHARS = 80;
const MAX_PRICE_NOTE_CHARS = 160;

function shortText(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/\s+/g, " ").trim();
  return compact ? compact.slice(0, max) : null;
}

function parseBooking(value: unknown): BookingStatus | null {
  return value === "required" || value === "recommended" || value === "not_needed" ? value : null;
}

function getSynthesisRejectionReason(
  parsed: LlmSynthesis | null,
  targetLanguage: TargetLanguage,
): string | null {
  if (!parsed) return "invalid-json";
  if (
    !looksLikeTargetLanguage(parsed.description, targetLanguage) ||
    !looksLikeTargetLanguage(parsed.review, targetLanguage)
  ) {
    return "bad-language";
  }
  if (
    (parsed.description?.length ?? 0) > MAX_SENTENCE_CHARS ||
    (parsed.review?.length ?? 0) > MAX_SENTENCE_CHARS
  ) {
    return "too-long";
  }
  if ([parsed.description, parsed.review].some((text) => isUnreadableText(text))) {
    return "unreadable";
  }
  return null;
}

/** Progress callback for model loading */
export type ModelLoadProgressCallback = (progress: number) => void;

/** Prompt wording of each output language */
const LANGUAGE_NAMES: Record<TargetLanguage, string> = { fr: "French", en: "English" };

// --- WebGPU detection ---

export function isWebGpuAvailable(): boolean {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

// LLM Engine singleton
// We lazy-load @mlc-ai/web-llm to keep the main bundle small.
// The engine is a singleton: one model loaded at a time.

// A type-only import: the library itself loads on demand in initEngine
let engineInstance: MLCEngine | null = null;
/** In-flight load: concurrent initEngine() calls share one download. */
let initPromise: Promise<boolean> | null = null;

// Qwen2.5-3B-Instruct is the sweet spot for this constrained JSON-extraction task
// (better JSON adherence + FR than the 1.5B, same API, no Qwen3 <think> pitfall). ~2.5GB VRAM.
// Bigger/newer option if your GPU has headroom: "Qwen3-4B-q4f16_1-MLC" (~3.4GB): but then you
// MUST disable thinking mode or it emits <think> blocks that break JSON parsing.
const MODEL_ID = "Qwen2.5-3B-Instruct-q4f16_1-MLC";
/** Weights + KV cache budget of MODEL_ID; shown to the user by the capability check */
export const MODEL_VRAM_MB = 2500;

/**
 * Initialize the WebLLM engine and download/cache the model.
 * This can take 30s-2min on first load (~2.5GB download/VRAM for Qwen2.5-3B).
 * Subsequent loads use the browser cache (~2s).
 */
export async function initEngine(onProgress?: ModelLoadProgressCallback): Promise<boolean> {
  if (engineInstance) return true;

  if (!isWebGpuAvailable()) {
    return false;
  }

  // A second caller (double-click "Re-enrich all") must await the
  // same in-flight load, not start a second ~2.5GB download.
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      // Dynamic import to keep main bundle small
      const webllm = await import("@mlc-ai/web-llm");

      engineInstance = await webllm.CreateMLCEngine(MODEL_ID, {
        initProgressCallback: (report: { progress: number; text: string }) => {
          onProgress?.(report.progress);
        },
      });

      return true;
    } catch (err) {
      dlog("llm").error("[WebLLM] Engine init failed", {
        err: err instanceof Error ? err.message : String(err),
      });
      engineInstance = null;
      return false;
    } finally {
      initPromise = null;
    }
  })();
  return initPromise;
}

/**
 * Check if the engine is ready for inference.
 */
export function isEngineReady(): boolean {
  return engineInstance != null;
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
  }
}

// --- Contract-aware prompt sections ---

/**
 * Build a prompt block from a category contract.
 * Injected into the system prompt to give the LLM category-specific guidance.
 *
 */
function buildContractBlock(category: string, bannedPatterns: readonly string[]): string {
  // Only the banned list is injected. Listing "priority signals" made the 3B model
  // copy them into its output ("terrace", "bike parking", "cyclist friendliness").
  const bannedList = bannedPatterns.map((b) => `  - ${b}`).join("\n");

  return `
Category-specific instructions for "${category}":

NEVER include in your output:
${bannedList}`;
}

// --- Synthesis prompt ---

/**
 * Build the system prompt for POI synthesis.
 * The LLM extracts structured info from raw search snippets.
 * Category-specific prompt hardening using contracts.
 * @param targetLanguage - language for the translatedSummary field
 * @param category - POI category for contract-aware prompt sections
 * Exported for testing.
 */
export function buildSystemPrompt(targetLanguage: TargetLanguage, category?: string): string {
  const langName = LANGUAGE_NAMES[targetLanguage];

  // Inject contract-specific instructions if available
  const contract = category ? getEnrichmentContract(category as PoiCategory) : null;
  const contractBlock = contract
    ? buildContractBlock(contract.category, contract.bannedPatterns)
    : "";

  // Price emphasis for the categories worth a full enrichment (all commercial)
  const priceBlock =
    category && getEnrichabilityPolicy(category as PoiCategory) === "full"
      ? `\n- "priceLevel": IMPORTANT for this category. Look for price indicators: €€/$$$ symbols, "inexpensive"/"moderate"/"expensive", explicit prices (15€, $20), Booking/Airbnb tariffs. 1=budget, 2=moderate, 3=upscale, 4=luxury.`
      : "";

  return `You are a travel assistant. Given web search snippets about a place, extract a compact summary for a cyclist.

Respond ONLY with a JSON object (no markdown, no backticks, no explanation):
{
  "rating": <number 1-5 or null>,
  "reviewCount": <number or null>,
  "hours": <array of {"day": "<Mon..Sun or a range like Mon-Fri>", "open": "<HH:MM or closed>", "close": "<HH:MM or null>"}, or null>,
  "description": <one sentence in ${langName}: what kind of place it is plus one practical detail stated in the snippets, or null>,
  "review": <one sentence in ${langName}, synthesis of reviews/reputation, or null>,
  "priceLevel": <number 1-4 or null, 1=cheap 4=expensive>,
  "season": <string or null: the opening period of a seasonal place (dates or months as the snippets state them), in ${langName}, max 80 characters>,
  "priceNote": <string or null: the concrete prices the snippets state, with unit and currency (per night, per meal, per person), max 160 characters>,
  "booking": <"required" | "recommended" | "not_needed" | null>
}

Rules:
- Extract ONLY what the snippets say. Do NOT invent or guess.
- Every value must come from a snippet. If the snippets are generic portals, directories or unrelated pages, return null for every field.
- If a field cannot be determined, use null. Never guess.
- Write ALL natural-language fields strictly in ${langName}. Never answer in Spanish, Basque, Romanian, or the source language unless ${langName} matches it.
- "rating": only from explicit ratings (e.g. "4.2/5"). Do not estimate from sentiment.
- "reviewCount": only from explicit counts (e.g. "238 reviews").
- "hours": structured table. Each entry has "day" (e.g. "Mon", "Mon-Fri", "Sat-Sun"), "open" (time or "closed"), "close" (time or null if closed). Use null for the whole field if no hours found.
- "description": ONE short sentence in ${langName}, max 160 characters: what kind of place it is (type, specialty) plus one practical detail a snippet states. Never mention cyclists unless a snippet does.
- "review": ONE short sentence in ${langName}, max 160 characters. Summarize reputation only: rating, review sentiment, key strengths or caveats. If sources disagree, say so.${priceBlock}
- "season": only when a snippet gives opening dates or months (a mountain hut, a campsite, a seasonal shop). Never derive it from weekly hours; null for places with weekly hours.
- "priceNote": copy amounts with their unit and currency as written. Never convert, never estimate; null when no amount is stated.
- "booking": only from an explicit statement that a reservation is required, recommended or not needed; otherwise null.
- Be maximally concise. No filler. Prefer null over uncertain data.
- Ignore snippets clearly unrelated to the POI (banking, novels, generic portals, wrong business).
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
  facts: string[] = [],
): string {
  const snippetText = snippets
    .map((s, i) => `[${i + 1}] ${s.title}\n${s.content}\n(source: ${s.engine})`)
    .join("\n\n");

  const websiteText = websitePreview
    ? `\n\nOfficial website preview:\nTitle: ${websitePreview.title ?? "n/a"}\nDescription: ${websitePreview.description ?? "n/a"}\nExcerpt: ${websitePreview.excerpt ?? "n/a"}\nSource URL: ${websitePreview.finalUrl}`
    : "";

  const factsText =
    facts.length > 0
      ? `\n\nOpenStreetMap facts (map data, reliable):\n${facts.map((fact) => `- ${fact}`).join("\n")}`
      : "";

  return `Place: "${poiName}" (${category})

Web search results:
${snippetText}
${websiteText}${factsText}

Extract the JSON:`;
}

// --- Synthesis ---

/** Max tokens for LLM response: 512 to fit full 7-day hours table + description + review */
const MAX_TOKENS = 512;

/** JSON schema enforced by web-llm (XGrammar): output is always valid JSON with these keys. */
const SYNTHESIS_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    rating: { type: ["number", "null"] },
    reviewCount: { type: ["integer", "null"] },
    hours: {
      type: ["array", "null"],
      items: {
        type: "object",
        properties: {
          day: { type: "string" },
          open: { type: "string" },
          close: { type: ["string", "null"] },
        },
        required: ["day", "open", "close"],
      },
    },
    description: { type: ["string", "null"] },
    review: { type: ["string", "null"] },
    priceLevel: { type: ["integer", "null"] },
    season: { type: ["string", "null"] },
    priceNote: { type: ["string", "null"] },
    booking: { type: ["string", "null"], enum: ["required", "recommended", "not_needed", null] },
  },
  required: [
    "rating",
    "reviewCount",
    "hours",
    "description",
    "review",
    "priceLevel",
    "season",
    "priceNote",
    "booking",
  ],
});

/** Temperature for synthesis (low = more factual) */
const TEMPERATURE = 0.1;

const MAX_SENTENCE_CHARS = 180;
const MAX_REPAIR_ATTEMPTS = 2;

function looksLikeTargetLanguage(text: string | null, targetLanguage: TargetLanguage): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  if (targetLanguage === "en") {
    // Reject if clearly Spanish or French
    return !/(\buna\b|\best[aeo]s?\b|\bhorarios?\b|\bopiniones\b|\brestaurante\b|\bcomer\b|\babierto\b|\bcerrado\b|\bc'est\b|\btrès\b|\bc'était\b|\bnotre\b|\bsont\b|\bavec\b|\bpour\b|\bdepuis\b|\bcette\b|\bvous\b|\bouverte?\b|\bfermée?\b)/i.test(
      lower,
    );
  }
  // Reject if clearly English: use unambiguous multi-word English-only phrases that don't
  // appear in French text (avoid single words like "restaurant", "open", "good").
  return !/(\breviews?\b|\bopening hours\b|\bclosed on\b|\bopen daily\b|\bopen every day\b|\brated\b|\brated \d|\bworth a visit\b|\bgreat place\b|\bthis place\b|\bnice place\b|\bgreat food\b|\bhighly recommend\b|\bmust try\b|\bstaff was\b|\bvery good\b|\bvery nice\b|\bthe food\b|\bthe place\b|\bthe staff\b|\bi loved\b|\bi visited\b|\bwe had\b|\bwe went\b)/i.test(
    lower,
  );
}

function isUnreadableText(text: string | null): boolean {
  if (!text) return false;
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length < 4) return true;
  if (/([!?.,])\1{3,}/.test(compact)) return true;
  if (/([a-zA-Z])\1{5,}/.test(compact)) return true;
  const weirdRatio =
    (compact.match(/[^\p{L}\p{N}\s.,:;!?()'"\-/%&]/gu) ?? []).length / compact.length;
  return weirdRatio > 0.15;
}

function buildRepairPrompt(targetLanguage: TargetLanguage, invalidJson: string): string {
  const langName = LANGUAGE_NAMES[targetLanguage];
  return `Rewrite this JSON so that description and review are strictly in ${langName}, each in one short sentence under 160 characters. Keep rating/reviewCount/hours/priceLevel/season/priceNote/booking unchanged when present. Reply with JSON only.\n\n${invalidJson}`;
}

function compactSentence(value: string | null): string | null {
  if (!value) return null;
  const compacted = value.replace(/\s+/g, " ").trim();
  if (!compacted) return null;
  const firstSentence =
    compacted.match(/^(.{1,180}?[.!?])(?:\s|$)/)?.[1] ?? compacted.slice(0, MAX_SENTENCE_CHARS);
  return firstSentence.trim().slice(0, MAX_SENTENCE_CHARS);
}

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
  facts: string[] = [],
): Promise<LlmSynthesis | null> {
  const engine = engineInstance;
  if (!engine || snippets.length === 0) return null;

  try {
    const log = dlog("llm");
    const systemPrompt = buildSystemPrompt(targetLanguage, category);
    let text: string | null = null;
    let parsed: LlmSynthesis | null = null;
    let rejectionReason: string | null = null;

    for (let attempt = 0; attempt <= MAX_REPAIR_ATTEMPTS; attempt++) {
      const response: ChatCompletion = await engine.chat.completions.create({
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content:
              attempt === 0
                ? buildUserPrompt(poiName, category, snippets, websitePreview, facts)
                : buildRepairPrompt(targetLanguage, text ?? ""),
          },
        ],
        max_tokens: MAX_TOKENS,
        temperature: TEMPERATURE,
        response_format: { type: "json_object", schema: SYNTHESIS_SCHEMA },
      });

      text = response.choices[0]?.message?.content?.trim() ?? null;
      if (!text) return null;
      parsed = parseLlmOutput(text);
      rejectionReason = getSynthesisRejectionReason(parsed, targetLanguage);
      if (parsed) {
        parsed.repaired = attempt > 0;
        parsed.repairReason = rejectionReason;
      }
      if (!rejectionReason) break;
      log.warn(`LLM output rejected for "${poiName}"`, {
        attempt,
        reason: rejectionReason,
        rawOutput: text.slice(0, 240),
      });
    }

    // Repairs exhausted and still rejected → let the deterministic
    // builder take over instead of shipping a bad synthesis.
    if (!parsed || rejectionReason) return null;
    const rawOutput = text ?? "";

    // Debug: log LLM synthesis result
    log.info(`LLM synthesis for "${poiName}"`, {
      rawOutput: rawOutput.slice(0, 300),
      rating: parsed?.rating,
      description: parsed?.description?.slice(0, 100),
      review: parsed?.review?.slice(0, 100),
      hoursEntries: parsed?.hours?.length ?? 0,
    });

    return parsed;
  } catch (err) {
    dlog("llm").error("[WebLLM] Synthesis failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Parse and bound the LLM output. Decoding is constrained by SYNTHESIS_SCHEMA,
 * so the text is plain JSON; a truncated one (max_tokens) does not parse: null.
 */
export function parseLlmOutput(text: string): LlmSynthesis | null {
  try {
    const parsed = JSON.parse(text);

    // Parse structured hours
    const hours = parseHoursField(parsed.hours);
    const hoursFlat = hours ? flattenHours(hours) : null;

    // Validate and coerce types
    return {
      rating:
        typeof parsed.rating === "number" && parsed.rating >= 1 && parsed.rating <= 5
          ? Math.round(parsed.rating * 10) / 10
          : null,
      reviewCount:
        typeof parsed.reviewCount === "number" && parsed.reviewCount >= 0
          ? Math.round(parsed.reviewCount)
          : null,
      hours,
      hoursFlat,
      description: compactSentence(
        typeof parsed.description === "string" ? parsed.description : null,
      ),
      review: compactSentence(typeof parsed.review === "string" ? parsed.review : null),
      priceLevel:
        typeof parsed.priceLevel === "number" && parsed.priceLevel >= 1 && parsed.priceLevel <= 4
          ? Math.round(parsed.priceLevel)
          : null,
      season: shortText(parsed.season, MAX_SEASON_CHARS),
      priceNote: shortText(parsed.priceNote, MAX_PRICE_NOTE_CHARS),
      booking: parseBooking(parsed.booking),
    };
  } catch {
    dlog("llm").warn("[WebLLM] Failed to parse LLM output", { text: text.slice(0, 200) });
    return null;
  }
}

// --- Hours parsing helpers ---

/** The hours array of the LLM output, entries without a day or an opening dropped; null if none. */
function parseHoursField(raw: unknown): OpeningHoursEntry[] | null {
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
  return null;
}

/**
 * Flatten structured hours to a human-readable string for exports.
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
