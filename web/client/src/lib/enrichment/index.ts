// ---------------------------------------------------------------------------
// Enrichment module – barrel export
// ---------------------------------------------------------------------------

export { buildGoogleMapsUrl, buildGoogleMapsDirectionsUrl, searchPoi, reverseGeocode, buildSearchQuery } from "./search";
export { isWebGpuAvailable, initEngine, isEngineReady, unloadEngine, synthesize } from "./llm";
export type { LlmSynthesis, ModelLoadProgressCallback } from "./llm";
export { enrichPoi, enrichBatch, computeConfidence } from "./enricher";
export type { EnrichmentProgressCallback, EnrichBatchOptions } from "./enricher";
