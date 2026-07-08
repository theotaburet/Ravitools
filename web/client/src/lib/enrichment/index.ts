// ---------------------------------------------------------------------------
// Enrichment module – barrel export
// ---------------------------------------------------------------------------

export type {
  EnrichBatchOptions,
  EnrichmentProgressCallback,
  PhaseProgressCallback,
  PoiStartCallback,
} from "./enricher";
export { computeConfidence, enrichBatch, enrichPoi, isRetryableEnrichmentResult } from "./enricher";
export type { LlmSynthesis, ModelLoadProgressCallback } from "./llm";
export { initEngine, isEngineReady, isWebGpuAvailable, synthesize, unloadEngine } from "./llm";
export {
  areAllEnginesSuspended,
  buildCaptchaResolveUrl,
  buildGoogleMapsSnippets,
  buildGoogleMapsUrl,
  buildSearchQuery,
  classifySourcePlatform,
  countSuspendedHealthyEngines,
  enqueueGoogleMapsPreview,
  fetchGoogleMapsJobStats,
  fetchWebsitePreview,
  getOfficialWebsiteUrl,
  pollGoogleMapsPreviewJob,
  resetEngineFailureState,
  reverseGeocode,
  searchPoi,
} from "./search";
export {
  buildDivergences,
  buildSourceDigests,
  buildStructuredContent,
  determineSourceConfirmation,
  extractStructuredHoursFromSnippets,
  rankSnippetsByQuality,
} from "./structured";
