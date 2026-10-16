// --- Enrichment module: the API the app state and components use ---

export type { LlmCapability, LlmCapabilityLevel, LlmCapabilityReason } from "./capability";
export { probeLlmCapability } from "./capability";
export { computeConfidence } from "./confidence";
export {
  areAllEnginesSuspended,
  buildCaptchaResolveUrl,
  resetEngineFailureState,
} from "./engine-health";
export type {
  EnrichBatchOptions,
  EnrichmentProgressCallback,
  PhaseProgressCallback,
  PoiStartCallback,
} from "./enricher";
export {
  type EnrichmentTally,
  enrichBatch,
  enrichPoi,
  isRetryableEnrichmentResult,
  tallyEnrichments,
} from "./enricher";
export { buildGoogleMapsUrl, fetchGoogleMapsJobStats } from "./google-maps";
export type { LlmSynthesis, ModelLoadProgressCallback } from "./llm";
export { initEngine, isEngineReady, isWebGpuAvailable, synthesize, unloadEngine } from "./llm";
export { extractStructuredHoursFromSnippets, rankSnippetsByQuality } from "./structured";
export { getOfficialWebsiteUrl } from "./websites";
