// ---------------------------------------------------------------------------
// Domain types for Ravitools
// ---------------------------------------------------------------------------

/** A single point on a GPX trace */
export interface TracePoint {
  lat: number;
  lon: number;
  ele?: number;
  time?: string;
}

/** Result of GPX parsing & simplification */
export interface TraceData {
  /** Unique identifier for this trace */
  id: string;
  /** Original parsed points */
  original: TracePoint[];
  /** Simplified/resampled points used for Overpass queries */
  simplified: TracePoint[];
  /** Total distance in meters */
  totalDistanceM: number;
  /** Name from GPX metadata if available */
  name?: string;
  /** Display color for map rendering */
  color: string;
}

/** V1 POI categories – matches config.yaml OSM_POI_configuration keys */
export type PoiCategory =
  | "Water"
  | "Sleeping place"
  | "Restroom"
  | "Shelter"
  | "Food shop"
  | "Restaurant or Bar"
  | "Gears"
  | "DIY"
  | "Laundry"
  | "Medical"
  | "Bank & ATM"
  | "Post office"
  | "Viewpoint"
  | "Tourist info"
  | "Charging"
  | "Picnic"
  | "Pharmacy"
  | "Wifi";

/** An OSM tag matcher from config.yaml */
export interface OsmTagMatcher {
  key: string; // e.g. "amenity"
  value: string; // e.g. "drinking_water"
  icon: string; // Font Awesome icon name
  group?: string;
}

/** Style for a POI category */
export interface PoiStyle {
  iconShape: string;
  borderColor: string;
  borderWidth: string;
  textColor: string;
  backgroundColor: string;
}

/** Configuration for a single POI category */
export interface PoiCategoryConfig {
  category: PoiCategory;
  style: PoiStyle;
  tags: OsmTagMatcher[];
  /** Whether this category is enabled by default (essential vs optional) */
  defaultEnabled?: boolean;
}

/** A processed Point of Interest */
export interface POI {
  id: string;
  lat: number;
  lon: number;
  category: PoiCategory;
  /** Display name */
  name: string;
  /** Icon identifier */
  icon: string;
  /** Distance to nearest point on the trace (meters) */
  distanceToTrace: number;
  /** Raw OSM tags */
  tags: Record<string, string>;
  /** Style from category config */
  style: PoiStyle;
  /** OSM element ID for dedup */
  osmId?: number;
  osmType?: "node" | "way" | "relation";
}

/** Processing pipeline state */
export type PipelineStage =
  | "idle"
  | "parsing"
  | "simplifying"
  | "querying"
  | "processing"
  | "done"
  | "error";

// ---------------------------------------------------------------------------
// Enrichment types
// ---------------------------------------------------------------------------

/** Enrichability policy: how much enrichment effort a category deserves */
export type EnrichabilityPolicy = "full" | "minimal" | "skip";

/** Why enrichment was skipped for a POI */
export type SkipReason =
  | "unnamed"
  | "low-value-category"
  | "no-results"
  | "rate-limited"
  | "cancelled";

/** Supported output languages for enrichment synthesis */
export type TargetLanguage = "fr" | "en";

/** Human-readable labels for target languages */
export const TARGET_LANGUAGE_LABELS: Record<TargetLanguage, string> = {
  fr: "Français",
  en: "English",
};

/** A single search snippet from SearXNG */
export interface SearchSnippet {
  title: string;
  url: string;
  content: string; // text excerpt
  engine: string; // "google", "bing", "duckduckgo"...
}

/** Status of enrichment for a single POI */
export type EnrichmentStatus = "pending" | "searching" | "synthesizing" | "done" | "error" | "skipped";

/** Enriched data attached to a POI after LLM synthesis */
export interface EnrichedData {
  /** Rating extracted from search snippets (1-5 scale, null if not found). Not an aggregation — reflects whatever rating sources mention. */
  rating: number | null;
  /** Review count extracted from search snippets (null if not found). Reflects source-reported count, not our own aggregation. */
  reviewCount: number | null;
  /** Opening hours as human-readable string, extracted from snippets */
  hours: string | null;
  /** Short summary of the place (2-3 sentences max), synthesized from snippets in source language */
  summary: string | null;
  /** Summary translated/rewritten in the user's target language. Null when no LLM or language matches source. */
  translatedSummary: string | null;
  /** Type/cuisine/specialty (e.g. "Italian restaurant", "mountain bike shop") */
  specialty: string | null;
  /** Price level (1-4 scale, null if unknown). Extracted from snippets, not verified. */
  priceLevel: number | null;
  /** Direct Google Maps link */
  googleMapsUrl: string;
  /** Source URLs that contributed to this enrichment */
  sourceUrls: string[];
  /** Raw search snippets before LLM synthesis */
  rawSnippets: SearchSnippet[];
  /** When was this enrichment performed */
  enrichedAt: string; // ISO timestamp
  /** Enrichment status */
  status: EnrichmentStatus;
  /** Error message if enrichment failed */
  error?: string;
  /** Why enrichment was skipped (only set when status === "skipped") */
  skipReason?: SkipReason;
  /** City/locality resolved via reverse geocoding */
  locality: string | null;
  /** Number of distinct search snippets used (0 = no data) */
  sourceCount: number;
  /** Names of search engines that contributed snippets */
  sourceEngines: string[];
  /** Confidence score 0-1 based on source count, agreement, and structured field presence */
  confidence: number;
}

/** Overall enrichment job state */
export type EnrichmentJobStage =
  | "idle"
  | "loading-model" // downloading/initializing WebLLM
  | "running" // batch in progress
  | "done"
  | "error";

/** Current phase within "running" stage */
export type EnrichmentPhase =
  | "geocode-search" // fetching data from Nominatim + SearXNG
  | "synthesize"     // LLM inference
  | "idle";          // not actively enriching

/** Enrichment job progress */
export interface EnrichmentJobState {
  stage: EnrichmentJobStage;
  /** Total POIs to enrich */
  total: number;
  /** POIs completed (done or error or skipped) */
  completed: number;
  /** Current POI being processed */
  currentPoiName: string | null;
  /** LLM model loading progress (0-1) */
  modelLoadProgress: number;
  /** Whether WebGPU is available */
  webGpuAvailable: boolean;
  /** Target language for synthesis output */
  targetLanguage: TargetLanguage;
  /** Error message */
  error: string | null;
  /** Current enrichment phase within "running" stage */
  phase: EnrichmentPhase;
  /** Estimated time remaining in seconds (null if not enough data) */
  etaSeconds: number | null;
}

/** Palette of distinct trace colors (cycling) */
export const TRACE_COLORS = [
  "#1a1a1a", // black (primary trace)
  "#e63946", // red
  "#2a9d8f", // teal
  "#e9c46a", // gold
  "#264653", // dark teal
  "#f4845f", // coral
  "#7209b7", // purple
  "#4361ee", // blue
  "#f72585", // magenta
  "#06d6a0", // mint
] as const;

/** Application state */
export interface AppState {
  stage: PipelineStage;
  traces: TraceData[];
  pois: POI[];
  activeCategories: Set<PoiCategory>;
  error: string | null;
  progress: string;
}
