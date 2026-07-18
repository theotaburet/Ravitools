// ---------------------------------------------------------------------------
// Snippet filtering: obvious noise + geographic coherence
// ---------------------------------------------------------------------------

import type { GeoContext, POI, SearchSnippet } from "../../types";
import { dlog } from "../debug-log";

const BAD_RESULT_PATTERNS = [/my unicredit banking/i, /internet banking/i, /login/i, /sign in/i];

/**
 * Regex covering non-latin scripts: CJK, Cyrillic, Arabic, Hebrew, Hangul, Hiragana/Katakana, Devanagari.
 * A snippet whose title or content is dominated by these characters is likely returned by a
 * wrong-locale engine (e.g. Yandex/Baidu) and should be rejected.
 */
const NON_LATIN_SCRIPT_RE =
  /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0900-\u097f]/;

export function isObviousNoiseSnippet(
  snippet: SearchSnippet,
  _poi: POI,
  _locality: string | null,
): boolean {
  const title = snippet.title.toLowerCase();
  const content = snippet.content.toLowerCase();
  const url = snippet.url.toLowerCase();

  if (
    BAD_RESULT_PATTERNS.some(
      (pattern) => pattern.test(title) || pattern.test(content) || pattern.test(url),
    )
  ) {
    return true;
  }

  // Reject snippets dominated by non-latin script (CJK, Cyrillic, Arabic, etc.)
  // A single stray character is acceptable; reject only when the title or a long content prefix is non-latin.
  const sampleText = `${snippet.title} ${snippet.content.slice(0, 200)}`;
  const nonLatinChars = (sampleText.match(NON_LATIN_SCRIPT_RE) ?? []).length;
  const nonLatinDensity = nonLatinChars / Math.max(sampleText.replace(/\s/g, "").length, 1);
  if (nonLatinDensity > 0.15) {
    dlog("search").info(
      `Non-latin script noise rejected: "${snippet.title}" (density ${nonLatinDensity.toFixed(2)})`,
      { url: snippet.url },
    );
    return true;
  }

  return false;
}

/**
 * Check if a snippet is geographically coherent with the expected location.
 * Returns false if the snippet clearly refers to a different city/region.
 *
 * Strategy:
 * - Extract city/region mentions from snippet title + content
 * - If snippet mentions a specific city that is NOT the expected locality,
 *   and does NOT mention the expected locality, it's a mismatch
 * - Conservative: only reject when confident (explicit city mention in title)
 */
export function isSnippetGeographicallyCoherent(
  snippet: { title: string; content: string; url: string },
  geoContext: GeoContext | null,
  locality: string | null,
): boolean {
  if (!geoContext && !locality) return true; // No geo data, can't filter

  const expectedLocality = locality?.toLowerCase() ?? "";
  const expectedCounty = geoContext?.county?.toLowerCase() ?? "";
  const expectedState = geoContext?.state?.toLowerCase() ?? "";
  const expectedCountry = geoContext?.country?.toLowerCase() ?? "";

  // Combine title and content for analysis (title is more authoritative)
  const titleLower = snippet.title.toLowerCase();
  const contentLower = snippet.content.toLowerCase();
  const fullText = `${titleLower} ${contentLower}`;

  // If snippet mentions the expected locality, county, state or country → keep it
  if (expectedLocality && fullText.includes(expectedLocality)) return true;
  if (expectedCounty && fullText.includes(expectedCounty)) return true;
  if (expectedState && fullText.includes(expectedState)) return true;
  if (expectedCountry && fullText.includes(expectedCountry)) return true;

  // --- Title-based city detection ---
  // Tripadvisor, Google Maps, Booking titles often have "Name, City" pattern
  // e.g. "Deni's, Torrevieja" or "Hotel du Port - Lyon"
  const titleCityPatterns = [
    /,\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)\s*[-–:·]?\s*/, // "Name, City"
    /[-–]\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)\s*$/, // "Name - City"
    /in\s+([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)/i, // "... in City"
  ];

  for (const pattern of titleCityPatterns) {
    const match = snippet.title.match(pattern);
    if (match) {
      const mentionedCity = match[1].trim().toLowerCase();
      // Skip very short matches (noise) or matches that ARE the expected locality/region
      if (mentionedCity.length < 3) continue;
      if (expectedLocality && mentionedCity === expectedLocality) return true;
      if (expectedCounty && mentionedCity === expectedCounty) return true;
      if (expectedCountry && mentionedCity === expectedCountry) return true;

      // The title explicitly mentions a different city → suspicious
      // But only reject if it's NOT a substring of our expected locality
      if (
        expectedLocality &&
        !expectedLocality.includes(mentionedCity) &&
        !mentionedCity.includes(expectedLocality)
      ) {
        dlog("search").info(
          `Geographic mismatch: snippet "${snippet.title}" mentions "${mentionedCity}" but expected "${expectedLocality}" (${expectedCountry})`,
          {
            url: snippet.url,
            mentionedCity,
            expectedLocality,
            expectedCountry,
          },
        );
        return false;
      }
    }
  }

  // URL-based check intentionally omitted — too many false positives.

  return true; // Default: keep the snippet (conservative)
}
