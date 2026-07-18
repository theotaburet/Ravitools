// ---------------------------------------------------------------------------
// Confidence scoring for enrichment results
// ---------------------------------------------------------------------------

/**
 * Compute a confidence score (0-1) for an enrichment result.
 * WS10: richer formula with official website bonus, snippet quality,
 * review volume weight, and platform diversity.
 *
 * Components (sum, capped at 1.0):
 *   sourceFactor   (0-0.25): snippet count, saturates at ~6
 *   diversityFactor(0-0.15): distinct search engines
 *   fieldFactor    (0-0.20): each non-null structured field adds weight
 *   officialBonus  (0-0.15): official website presence
 *   qualityFactor  (0-0.15): snippet content quality (avg length, URL diversity)
 */
export function computeConfidence(enrichment: {
  rawSnippets: { engine: string; content?: string; url?: string }[];
  rating: number | null;
  reviewCount: number | null;
  hours: string | null;
  description: string | null;
  review: string | null;
  officialWebsite?: { url: string } | null;
  structured?: { divergences: string[] } | null;
}): number {
  const snippetCount = enrichment.rawSnippets.length;
  if (snippetCount === 0) return 0;

  // --- Source count factor (0-0.25): diminishing returns, saturates at ~6 snippets ---
  // ponytail: capped lower than before so raw snippet count no longer dominates over
  // authoritative sources (AUDIT C9). 6/24 = 0.25.
  const sourceFactor = Math.min(snippetCount / 24, 0.25);

  // --- Engine diversity factor (0-0.15): multiple engines = higher confidence ---
  const engines = new Set(enrichment.rawSnippets.map((s) => s.engine));
  const diversityFactor = Math.min(engines.size * 0.05, 0.15);

  // --- Structured field presence factor (0-0.20) ---
  let fieldFactor = 0;
  if (enrichment.rating != null) fieldFactor += 0.04;
  if (enrichment.reviewCount != null) fieldFactor += 0.04;
  if (enrichment.hours != null) fieldFactor += 0.04;
  if (enrichment.description != null) fieldFactor += 0.04;
  if (enrichment.review != null) fieldFactor += 0.04;
  fieldFactor = Math.min(fieldFactor, 0.2);

  // --- Official website bonus (0-0.15): an official source is worth more than snippet volume (AUDIT C9) ---
  const officialBonus = enrichment.officialWebsite ? 0.15 : 0;

  // --- Snippet quality factor (0-0.15) ---
  let qualityFactor = 0;
  if (snippetCount > 0) {
    // Average content length: longer snippets tend to have more useful information
    const avgContentLength =
      enrichment.rawSnippets.reduce((sum, s) => sum + (s.content?.length ?? 0), 0) / snippetCount;
    // Normalize: 50+ chars average = good (0.05), 150+ chars = very good (0.10)
    qualityFactor += Math.min(avgContentLength / 1500, 0.1);

    // URL diversity: snippets from different domains = more corroboration
    const domains = new Set(
      enrichment.rawSnippets
        .map((s) => {
          try {
            return new URL(s.url ?? "").hostname;
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    );
    qualityFactor += Math.min(domains.size * 0.025, 0.05);
  }
  qualityFactor = Math.min(qualityFactor, 0.15);

  // --- Contradiction penalty (WS11): divergences reduce confidence ---
  const divergenceCount = enrichment.structured?.divergences?.length ?? 0;
  const contradictionPenalty = Math.min(divergenceCount * 0.05, 0.15);

  const raw =
    sourceFactor +
    diversityFactor +
    fieldFactor +
    officialBonus +
    qualityFactor -
    contradictionPenalty;
  return Math.min(Math.max(Math.round(raw * 100) / 100, 0), 1);
}

/** Extract unique engine names from snippets */
export function extractEngines(snippets: { engine: string }[]): string[] {
  return [...new Set(snippets.map((s) => s.engine))];
}
