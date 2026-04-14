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
  /** Positive elevation gain in meters */
  elevationGainM: number;
  /** Negative elevation loss in meters */
  elevationLossM: number;
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
  /** Distance along the trace from its start to the POI's nearest projection (meters).
   *  Used for ordering POIs in trace-travel order. */
  alongTraceDistance: number;
  /** Raw OSM tags */
  tags: Record<string, string>;
  /** Style from category config */
  style: PoiStyle;
  /** OSM element ID for dedup */
  osmId?: number;
  osmType?: "node" | "way" | "relation";
}

/** User-tunable route processing settings */
export interface RouteProcessingSettings {
  /** Maximum accepted distance from the route, in meters */
  maxDistanceM: number;
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
  | "generic-name"
  | "low-value-category"
  | "no-results"
  | "rate-limited"
  | "cancelled";

/** Supported output languages for enrichment synthesis */
export type TargetLanguage = "fr" | "en";

/** Canonical source platforms used in enrichment synthesis */
export const ENRICHMENT_PLATFORMS = [
  "google_maps",
  "yelp",
  "tripadvisor",
  "facebook",
  "instagram",
  "booking",
  "hotels_com",
  "official_website",
  "other",
] as const;

export type EnrichmentPlatform = typeof ENRICHMENT_PLATFORMS[number];

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

/** Structured, user-facing digest for a source platform */
export interface EnrichmentSourceDigest {
  platform: EnrichmentPlatform;
  brief: string;
  url: string | null;
}

/** Hardened, stable structure for traveler-facing enrichment output */
export interface EnrichmentStructuredContent {
  /** One-paragraph synthesis that should stand on its own */
  headline: string | null;
  /** Operational verdict for quick scanning */
  operationalSummary: string | null;
  /** Reliable practical facts only */
  practicalities: string[];
  /** What web/review platforms say, one line each */
  sourceRollup: EnrichmentSourceDigest[];
  /** Main caveats, disagreement, or missing info */
  cautions: string[];
  /** Key unknowns that could matter to the traveler */
  unknowns: string[];
  /** Explicit source divergences detected across platforms */
  divergences: string[];
  /** Which facts were confirmed by official website vs review platforms only */
  sourceConfirmation: "official" | "reviews-only" | "both" | "none";
}

// ---------------------------------------------------------------------------
// Category-level enrichment contracts
// ---------------------------------------------------------------------------

/**
 * Enrichment depth policy per enrichable category.
 * Defines what each "full" category is expected to produce, what signals matter,
 * and what must NOT be said.
 */
export interface EnrichmentCategoryContract {
  /** The POI category this contract applies to */
  category: PoiCategory;
  /** What the enrichment output should prioritize, ordered */
  priorities: string[];
  /** Signals that matter for this category */
  valuableSignals: string[];
  /** What must never appear in the output */
  bannedPatterns: string[];
  /** Preferred wording patterns when sources are weak */
  weakSourceFormulations: string[];
  /** Preferred wording patterns when sources contradict */
  contradictionFormulations: string[];
  /** When to prefer silence over a bad synthesis */
  silenceConditions: string[];
}

/**
 * Length targets for enrichment text fields across display contexts.
 * Used to keep output readable on all surfaces.
 */
export interface EnrichmentLengthTargets {
  /** Max chars for headline on mobile popup */
  headlineMobile: number;
  /** Max chars for headline in list view */
  headlineList: number;
  /** Max chars for operationalSummary */
  operationalSummary: number;
  /** Max chars for essentials in export (GPX, KML) */
  essentialsExport: number;
  /** Max number of practicalities items */
  practicalitiesMax: number;
  /** Max number of cautions items */
  cautionsMax: number;
  /** Max number of unknowns items */
  unknownsMax: number;
}

/** Canonical length targets for all display surfaces */
export const ENRICHMENT_LENGTH_TARGETS: EnrichmentLengthTargets = {
  headlineMobile: 200,
  headlineList: 320,
  operationalSummary: 240,
  essentialsExport: 700,
  practicalitiesMax: 5,
  cautionsMax: 3,
  unknownsMax: 2,
};

/** Canonical information ordering for enrichment output */
export const ENRICHMENT_DISPLAY_ORDER = [
  "headline",
  "operationalSummary",
  "practicalities",
  "cautions",
  "divergences",
  "unknowns",
  "sourceRollup",
  "sourceConfirmation",
] as const;

/** Minimal fetched preview of an official website */
export interface WebsitePreview {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  excerpt: string | null;
  fetchedAt: string;
 }

/** Rich geographic context from reverse geocoding, used for search query building and snippet filtering */
export interface GeoContext {
  /** Most specific locality (city/town/village/hamlet) */
  locality: string | null;
  /** County or department */
  county: string | null;
  /** State or region */
  state: string | null;
  /** Country name */
  country: string | null;
  /** Country code (ISO 3166-1 alpha-2, lowercase) */
  countryCode: string | null;
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
  /** Full geographic context from reverse geocoding */
  geoContext?: GeoContext | null;
  /** Search query sent to SearXNG (debug) */
  searchQuery?: string | null;
  /** Number of distinct search snippets used (0 = no data) */
  sourceCount: number;
  /** Names of search engines that contributed snippets */
  sourceEngines: string[];
  /** Confidence score 0-1 based on source count, agreement, and structured field presence */
  confidence: number;
  /** Main user-facing synthesis in target language, concise but complete on essentials */
  essentials?: string | null;
  /** Short per-platform digest when the sources are identifiable */
  sourceDigests?: EnrichmentSourceDigest[];
  /** Working official website preview when a fetch succeeded */
  officialWebsite?: WebsitePreview | null;
  /** Hardened structured content consumed by UI/export/sandbox */
  structured?: EnrichmentStructuredContent;
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
  | "retry"          // retrying failed POIs
  | "idle";          // not actively enriching

/** Enrichment job progress */
export interface EnrichmentJobState {
  stage: EnrichmentJobStage;
  /** Total POIs to enrich */
  total: number;
  /** POIs completed (done or error or skipped) */
  completed: number;
  /** POIs that completed with errors */
  errorCount: number;
  /** POIs skipped (generic name, low-value category, etc.) */
  skippedCount: number;
  /** Current POI being processed */
  currentPoiName: string | null;
  /** ID of the POI currently being enriched (for UI highlighting) */
  currentPoiId: string | null;
  /** LLM model loading progress (0-1) */
  modelLoadProgress: number;
  /** Whether WebGPU is available */
  webGpuAvailable: boolean;
  /** Whether SearXNG search service is available */
  searxngAvailable: boolean;
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
  routeSettings: RouteProcessingSettings;
  error: string | null;
  progress: string;
  /** Numeric progress ratio 0-1 for progress bar (null = indeterminate) */
  progressRatio: number | null;
  /** Non-blocking warning (e.g. partial results due to failed chunks) */
  warning: string | null;
}
