// --- Domain types for Ravitools ---

import type { IconNode } from "lucide";

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

/** POI categories */
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

/** Map families: the color says the family, the glyph says the category (design.md 3.4) */
export type PoiFamily =
  | "Water"
  | "Food"
  | "Sleep"
  | "Mechanics"
  | "Health"
  | "Services"
  | "Discovery";

/** "cvd": the colour-blind (Okabe-Ito) palette */
export type Palette = "default" | "cvd";

/** An OSM tag matcher */
export interface OsmTagMatcher {
  key: string; // e.g. "amenity"
  value: string; // e.g. "drinking_water"
  icon: string; // Font Awesome icon name
  group?: string;
  /** Skip elements carrying one of these tag values (a bus shelter is not a roof for the night) */
  unless?: Record<string, string[]>;
  /** Keep only elements carrying one of these values (`;` lists count); Overpass filters it too */
  only?: Record<string, string[]>;
}

/** Configuration for a single POI category */
export interface PoiCategoryConfig {
  category: PoiCategory;
  family: PoiFamily;
  /** Default lucide glyph on the family color (a tag's own glyph wins, see poiGlyph) */
  glyph: IconNode;
  /** Map marker emoji (a tag's own emoji wins, see poiEmoji) */
  emoji: string;
  /** "full": geocode + search + LLM; "minimal": geocode only; "skip": no network, Google Maps link only */
  policy: EnrichabilityPolicy;
  /** Same-category POIs closer than the dedup radius merge (two water taps yes, two restaurants no) */
  mergeable: boolean;
  /** GPX `<sym>` understood by Garmin-like devices */
  gpxSymbol: string;
  /** FIT `course_point` type (FIT Profile enum): the icon each device draws */
  fitType: number;
  /** OsmAnd GPX extensions: icon name ("key_value") and background shape */
  osmand: { icon: string; background: "circle" | "octagon" | "square" };
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
  /** `TraceData.id` of the nearest trace (multi-GPX: the profile and roadbook it belongs to) */
  traceId: string;
  /** Raw OSM tags */
  tags: Record<string, string>;
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

// --- Enrichment types ---

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

/** Source platforms of the enrichment (labels, order and matching: PLATFORMS in enrichment/websites.ts) */
export type EnrichmentPlatform =
  | "google_maps"
  | "yelp"
  | "tripadvisor"
  | "facebook"
  | "instagram"
  | "booking"
  | "airbnb"
  | "hotels_com"
  | "official_website"
  | "other";

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
  /** What web/review platforms say, one line each */
  sourceRollup: EnrichmentSourceDigest[];
  /** Main caveats, disagreement, or missing info */
  cautions: string[];
  /** Explicit source divergences detected across platforms */
  divergences: string[];
  /** Which facts were confirmed by official website vs review platforms only */
  sourceConfirmation: "official" | "reviews-only" | "both" | "none";
}

// --- Category-level enrichment contracts ---

/** What a "full" category must never say (its weak-source caution: `caution.weakSource.*` in i18n.ts) */
export interface EnrichmentCategoryContract {
  /** The POI category this contract applies to */
  category: PoiCategory;
  /** What must never appear in the output */
  bannedPatterns: string[];
}

/** Minimal fetched preview of an official website */
export interface WebsitePreview {
  url: string;
  finalUrl: string;
  title: string | null;
  description: string | null;
  excerpt: string | null;
  structuredData?: {
    description: string | null;
    telephone: string | null;
    priceRange: string | null;
    openingHours: string[];
    rating: number | null;
    reviewCount: number | null;
  } | null;
  fetchedAt: string;
  /** Readable page text, capped server-side: feeds the evidence windows, never stored */
  text?: string | null;
  /** Same-host links (text + absolute href): the menu says where prices and hours live */
  links?: { text: string; href: string }[];
}

export interface GoogleMapsPreview {
  url: string;
  resolvedUrl: string | null;
  title: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  hoursText: string | null;
  /** Structured opening hours extracted from the expanded hours panel (7-day table). */
  structuredHours: OpeningHoursEntry[] | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  snippet: string | null;
  fetchedAt: string;
  /** Layout checks that failed on the source page (optional: older servers omit it) */
  layoutWarnings?: string[];
}

export interface GoogleMapsPreviewJob {
  jobId: string;
  status: "queued" | "running" | "done" | "error";
  url: string;
  /** Human-readable POI name for UI display */
  poiName: string | null;
  preview: GoogleMapsPreview | null;
  error?: string | null;
  /** ISO timestamp when the job started running */
  startedAt: string | null;
  /** Current attempt number (1-based) */
  attempt: number;
  /** ISO timestamp of next scheduled retry */
  nextRetryAt: string | null;
  /** Last extraction error message */
  lastError: string | null;
}

export interface GoogleFallbackJobStats {
  counts: {
    queued: number;
    running: number;
    done: number;
    error: number;
    /** Jobs blocked by CAPTCHA/anti-bot (subset of error/running). Optional: older servers omit it. */
    blocked?: number;
    /** Done jobs whose page had a section we could not parse (source layout drift). Optional: older servers omit it. */
    layoutIssues?: number;
  };
  jobs: GoogleMapsPreviewJob[];
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
export type EnrichmentStatus =
  | "pending"
  | "searching"
  | "synthesizing"
  | "done"
  | "error"
  | "skipped";

/** A single opening hours entry for one day or day range */
export interface OpeningHoursEntry {
  /** Day or day range (e.g. "Mon", "Mon-Fri", "Sat-Sun") */
  day: string;
  /** Opening time (e.g. "08:00") or "closed" */
  open: string;
  /** Closing time (e.g. "18:00") or null when open === "closed" */
  close: string | null;
}

/** Whether a reservation is needed, as stated by the sources */
export type BookingStatus = "required" | "recommended" | "not_needed";

/** Enriched data attached to a POI after LLM synthesis */
export interface EnrichedData {
  /** Rating extracted from search snippets (1-5 scale, null if not found). Not an aggregation: reflects whatever rating sources mention. */
  rating: number | null;
  /** Review count extracted from search snippets (null if not found). Reflects source-reported count, not our own aggregation. */
  reviewCount: number | null;
  /** Opening hours as human-readable string, extracted from snippets */
  hours: string | null;
  /** Structured opening hours table (compact LLM output). Null when no LLM or no hours found. */
  openingHours: OpeningHoursEntry[] | null;
  /** One-sentence description in target language */
  description: string | null;
  /** One-sentence review synthesis in target language (compact LLM output). */
  review: string | null;
  /** Price level (1-4 scale, null if unknown). Extracted from snippets, not verified. */
  priceLevel: number | null;
  /** Opening period for places that run by season rather than weekly hours, as the sources state it */
  season?: string | null;
  /** Prices with units and currency, as the sources state them ("night 21 €, half board 55 €") */
  priceNote?: string | null;
  /** Whether a reservation is needed, as the sources state it */
  booking?: BookingStatus | null;
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
  /** Working official website preview when a fetch succeeded */
  officialWebsite?: WebsitePreview | null;
  /** Hardened structured content consumed by UI/export/sandbox */
  structured?: EnrichmentStructuredContent;
  /** Engines that were unresponsive during search: [[engine_name, error_reason], ...] */
  unresponsiveEngines?: [string, string][];
  /** Origin of description/review synthesis shown in the UI */
  synthesisSource?: "llm" | "llm-repaired" | "deterministic";
  /** Why LLM output was repaired or replaced */
  synthesisReason?: string | null;
  /** Field names whose values were sourced from Google Maps (e.g. ["openingHours", "rating", "address"]) */
  googleMapsFields?: string[];
}

/** Overall enrichment job state */
export type EnrichmentJobStage =
  | "idle"
  | "loading-model" // downloading/initializing WebLLM
  | "running" // batch in progress
  | "paused-captcha" // paused: all engines blocked, user must solve CAPTCHA manually
  | "done"
  | "error";

/** Current phase within "running" stage */
export type EnrichmentPhase =
  | "geocode-search" // fetching data from Nominatim + SearXNG
  | "google-fallback" // waiting for slow Google Maps jobs
  | "synthesize" // LLM inference
  | "retry" // retrying failed POIs
  | "idle"; // not actively enriching

/** Enrichment job progress */
export interface EnrichmentJobState {
  stage: EnrichmentJobStage;
  /** Total POIs to enrich */
  total: number;
  /** POIs completed (done or error or skipped) */
  completed: number;
  /** POIs past the web search (searched, skipped or cached), the count shown while searching */
  searched: number;
  /** Current POI being processed (last started, for label display) */
  currentPoiName: string | null;
  /** ID of the POI currently being enriched (for label display) */
  currentPoiId: string | null;
  /** IDs of all POIs currently in-flight (for multi-marker animation) */
  activePoiIds: Set<string>;
  /** LLM model loading progress (0-1) */
  modelLoadProgress: number;
  /** Whether WebGPU is available */
  llmActive: boolean;
  /** Whether SearXNG search service is available */
  searxngAvailable: boolean;
  /** Error message */
  error: string | null;
  /** Current enrichment phase within "running" stage */
  phase: EnrichmentPhase;
  /** Estimated time remaining in seconds (null if not enough data) */
  etaSeconds: number | null;
  /** Status for slow Google Maps fallback queue/retries */
  googleFallbackStatus?: string | null;
  /** Server-side Google Maps queue stats */
  googleFallbackStats?: GoogleFallbackJobStats | null;
  /** URL to open in a new tab for manual CAPTCHA resolution (set when stage === "paused-captcha") */
  captchaUrl?: string | null;
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
