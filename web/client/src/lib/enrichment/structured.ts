import type {
  POI,
  EnrichedData,
  SearchSnippet,
  EnrichmentSourceDigest,
  WebsitePreview,
  EnrichmentPlatform,
  TargetLanguage,
  EnrichmentStructuredContent,
} from "../../types";
import { classifySourcePlatform } from "./search";

const PLATFORM_LABELS: Record<EnrichmentPlatform, string> = {
  google_maps: "Google Maps",
  yelp: "Yelp",
  tripadvisor: "Tripadvisor",
  facebook: "Facebook",
  instagram: "Instagram",
  booking: "Booking",
  hotels_com: "Hotels.com",
  official_website: "Official site",
  other: "Web",
};

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text: string, max: number): string {
  const value = compact(text);
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function representativeSnippet(snippets: SearchSnippet[]): SearchSnippet | null {
  return [...snippets].sort((a, b) => b.content.length - a.content.length)[0] ?? null;
}

function inferCategoryLead(poi: POI): string {
  switch (poi.category) {
    case "Restaurant or Bar":
      return `${poi.name} is a food stop near the route.`;
    case "Food shop":
      return `${poi.name} is a food resupply option near the route.`;
    case "Sleeping place":
      return `${poi.name} is a sleep option near the route.`;
    case "Gears":
      return `${poi.name} is a gear or bike-related stop near the route.`;
    default:
      return `${poi.name} is a ${poi.category.toLowerCase()} near the route.`;
  }
}

function buildPracticalities(
  enrichment: Pick<EnrichedData, "rating" | "reviewCount" | "hours" | "specialty" | "priceLevel" | "locality">,
  targetLanguage: TargetLanguage,
): string[] {
  const facts: string[] = [];
  if (enrichment.specialty) facts.push(`Type: ${enrichment.specialty}`);
  if (enrichment.rating != null) {
    facts.push(
      enrichment.reviewCount != null
        ? `Reported rating: ${enrichment.rating.toFixed(1)}/5 (${enrichment.reviewCount} reviews)`
        : `Reported rating: ${enrichment.rating.toFixed(1)}/5`,
    );
  }
  if (enrichment.hours) facts.push(`Hours: ${enrichment.hours}`);
  if (enrichment.priceLevel != null) facts.push(`Price level: ${"$".repeat(enrichment.priceLevel)}`);
  if (enrichment.locality) {
    facts.push(targetLanguage === "fr" ? `Localite: ${enrichment.locality}` : `Locality: ${enrichment.locality}`);
  }
  return uniqueStrings(facts).slice(0, 5);
}

function buildSourceRollup(
  snippets: SearchSnippet[],
  websitePreview?: WebsitePreview | null,
): EnrichmentSourceDigest[] {
  const groups = new Map<EnrichmentPlatform, SearchSnippet[]>();
  for (const snippet of snippets) {
    const platform = classifySourcePlatform(snippet.url);
    groups.set(platform, [...(groups.get(platform) ?? []), snippet]);
  }

  const digests: EnrichmentSourceDigest[] = [];
  for (const [platform, grouped] of groups) {
    const rep = representativeSnippet(grouped);
    if (!rep) continue;
    digests.push({
      platform,
      brief: `${PLATFORM_LABELS[platform]}: ${shorten(rep.content, 180)}`,
      url: rep.url,
    });
  }

  if (websitePreview && (websitePreview.description || websitePreview.excerpt || websitePreview.title)) {
    digests.push({
      platform: "official_website",
      brief: `Official site: ${shorten(websitePreview.description ?? websitePreview.excerpt ?? websitePreview.title ?? "", 180)}`,
      url: websitePreview.finalUrl,
    });
  }

  return digests;
}

function buildCautions(
  enrichment: Pick<EnrichedData, "hours" | "rating" | "reviewCount">,
  sourceRollup: EnrichmentSourceDigest[],
): string[] {
  const cautions: string[] = [];
  if (sourceRollup.length === 0) cautions.push("No identifiable review or discovery platform found.");
  if (enrichment.rating == null) cautions.push("No explicit rating found in the collected sources.");
  if (enrichment.hours == null) cautions.push("Opening hours were not confirmed from the collected sources.");
  if (enrichment.reviewCount == null && enrichment.rating != null) cautions.push("Rating found, but review volume was not confirmed.");
  return cautions.slice(0, 3);
}

function buildUnknowns(
  enrichment: Pick<EnrichedData, "hours" | "rating" | "reviewCount" | "specialty">,
  sourceRollup: EnrichmentSourceDigest[],
): string[] {
  const unknowns: string[] = [];
  if (enrichment.specialty == null && sourceRollup.length > 0) {
    unknowns.push("Exact type or specialty could not be determined from sources.");
  }
  return unknowns.slice(0, 2);
}

export function buildStructuredContent(
  poi: POI,
  enrichment: Pick<EnrichedData, "rating" | "reviewCount" | "hours" | "specialty" | "summary" | "translatedSummary" | "priceLevel" | "locality">,
  snippets: SearchSnippet[],
  websitePreview: WebsitePreview | null | undefined,
  targetLanguage: TargetLanguage,
): EnrichmentStructuredContent {
  const sourceRollup = buildSourceRollup(snippets, websitePreview);
  const lead = enrichment.translatedSummary ?? enrichment.summary ?? inferCategoryLead(poi);
  const practicalities = buildPracticalities(enrichment, targetLanguage);
  const cautions = buildCautions(enrichment, sourceRollup);
  const unknowns = buildUnknowns(enrichment, sourceRollup);

  const operationalSummaryParts = [
    enrichment.specialty ? `Best read as ${enrichment.specialty}.` : null,
    enrichment.hours ? `Hours available.` : `Hours unclear.`,
    enrichment.rating != null ? `Reputation signals present.` : `Reputation signals limited.`,
    sourceRollup.length > 0 ? `Coverage: ${sourceRollup.map((item) => PLATFORM_LABELS[item.platform]).join(", ")}.` : null,
  ];

  return {
    headline: shorten(lead, 320) || null,
    operationalSummary: shorten(uniqueStrings(operationalSummaryParts).join(" "), 240) || null,
    practicalities,
    sourceRollup,
    cautions,
    unknowns,
  };
}

export function buildEssentialsText(structured: EnrichmentStructuredContent): string | null {
  const parts = [
    structured.headline,
    structured.operationalSummary,
    structured.practicalities.length > 0 ? `Key facts: ${structured.practicalities.join("; ")}.` : null,
    structured.cautions.length > 0 ? `Cautions: ${structured.cautions.join(" ")}` : null,
    structured.unknowns.length > 0 ? `Unknown: ${structured.unknowns.join(" ")}` : null,
  ];
  const joined = uniqueStrings(parts).join(" ");
  return joined ? shorten(joined, 700) : null;
}

export function buildSourceDigests(
  snippets: SearchSnippet[],
  websitePreview?: WebsitePreview | null,
): EnrichmentSourceDigest[] {
  return buildSourceRollup(snippets, websitePreview);
}
