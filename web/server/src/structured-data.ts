// ---------------------------------------------------------------------------
// JSON-LD structured-data extraction from fetched HTML pages
// ---------------------------------------------------------------------------
export type WebsiteStructuredData = {
  description: string | null;
  telephone: string | null;
  priceRange: string | null;
  openingHours: string[];
  rating: number | null;
  reviewCount: number | null;
};

function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  // ponytail: cap regex work on untrusted fetched HTML (AUDIT S6).
  const capped = html.length > 2_000_000 ? html.slice(0, 2_000_000) : html;
  const matches = capped.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
}

function flattenJsonLd(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);

  const record = node as Record<string, unknown>;
  const nested = [
    ...(Array.isArray(record["@graph"]) ? flattenJsonLd(record["@graph"]) : []),
    ...flattenJsonLd(record.mainEntity),
  ];
  return [record, ...nested];
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed || null;
  }
  return null;
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOpeningHours(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(firstString).filter((item): item is string => Boolean(item));
  }
  const single = firstString(value);
  return single ? [single] : [];
}

export function extractStructuredDataFromHtml(html: string): WebsiteStructuredData | null {
  const nodes = parseJsonLdBlocks(html).flatMap(flattenJsonLd);
  const aggregateRatings = nodes
    .map((node) =>
      node.aggregateRating && typeof node.aggregateRating === "object"
        ? (node.aggregateRating as Record<string, unknown>)
        : null,
    )
    .filter((item): item is Record<string, unknown> => Boolean(item));

  const description = nodes.map((node) => firstString(node.description)).find(Boolean) ?? null;
  const telephone = nodes.map((node) => firstString(node.telephone)).find(Boolean) ?? null;
  const priceRange = nodes.map((node) => firstString(node.priceRange)).find(Boolean) ?? null;
  const openingHours = nodes.flatMap((node) => normalizeOpeningHours(node.openingHours));
  const rating =
    aggregateRatings.map((item) => firstNumber(item.ratingValue)).find((item) => item != null) ??
    null;
  const reviewCount =
    aggregateRatings
      .map((item) => firstNumber(item.reviewCount) ?? firstNumber(item.ratingCount))
      .find((item) => item != null) ?? null;

  if (
    !description &&
    !telephone &&
    !priceRange &&
    openingHours.length === 0 &&
    rating == null &&
    reviewCount == null
  ) {
    return null;
  }

  return {
    description,
    telephone,
    priceRange,
    openingHours: [...new Set(openingHours)],
    rating,
    reviewCount,
  };
}
