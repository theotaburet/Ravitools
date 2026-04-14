// ---------------------------------------------------------------------------
// Enrichment module – barrel export
// ---------------------------------------------------------------------------

export { buildGoogleMapsUrl, buildGoogleMapsDirectionsUrl, searchPoi, reverseGeocode, buildSearchQuery } from "./search";
export { getOfficialWebsiteUrl, classifySourcePlatform, fetchWebsitePreview } from "./search";
export { isWebGpuAvailable, initEngine, isEngineReady, unloadEngine, synthesize } from "./llm";
export type { LlmSynthesis, ModelLoadProgressCallback } from "./llm";
export { enrichPoi, enrichBatch, computeConfidence } from "./enricher";
export type { EnrichmentProgressCallback, PoiStartCallback, EnrichBatchOptions, PhaseProgressCallback } from "./enricher";
export { buildSourceDigests, buildEssentialsText, buildStructuredContent, buildDivergences, determineSourceConfirmation } from "./structured";
