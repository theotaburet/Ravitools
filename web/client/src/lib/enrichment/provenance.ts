import type { EnrichedData } from "../../types";
import { isRetryableEnrichmentResult } from "./enricher";

export function getSynthesisLabel(enrichment: EnrichedData): string | null {
  if (!enrichment.synthesisSource) return null;
  if (enrichment.synthesisSource === "llm") return "AI";
  if (enrichment.synthesisSource === "llm-repaired")
    return enrichment.synthesisReason
      ? `AI repaired · ${enrichment.synthesisReason}`
      : "AI repaired";
  return enrichment.synthesisReason ? `Fallback · ${enrichment.synthesisReason}` : "Fallback";
}

export function getSynthesisBadgeClass(enrichment: EnrichedData): string {
  switch (enrichment.synthesisSource) {
    case "llm":
      return "poi-badge poi-badge-ai";
    case "llm-repaired":
      return "poi-badge poi-badge-ai-repaired";
    case "deterministic":
      return "poi-badge poi-badge-fallback";
    default:
      return "poi-badge";
  }
}

/** Like isRetryableEnrichmentResult, but only for degraded skips (not errors/missing). */
export function isRetryableDegradedResult(enrichment: EnrichedData | undefined): boolean {
  return enrichment?.status === "skipped" && isRetryableEnrichmentResult(enrichment);
}
