// --- Evidence windows: the few sentences of a page that carry practical facts ---
// Universal patterns (clock times, money, phone numbers, date ranges) rather than
// words, so a page in any language yields the same kind of snippet. Each window
// keeps its source URL: the LLM quotes, it does not invent.

import type { SearchSnippet } from "../../types";
import { foldAccents, GENERIC_NAME_WORDS } from "./snippet-filters";
import { HOP_LINK_STEMS } from "./vocabulary";

/** Characters kept on each side of a match; two windows this wide stay under a tweet. */
const HALF_WINDOW = 130;

// Opening ranges: "08:30 à 18:30", "9h-18h", "9 AM to 6:30 PM". A lone "1h35" is a
// hiking duration on most pages, so a single time does not count unless it says AM/PM.
export const TIME_RE =
  /\b\d{1,2}(?:[:h]\d{2}|h)\s*(?:-|–|à|to|bis|a|tot|até)\s*\d{1,2}(?:[:h]\d{2}|h)\b|\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi;
// Money: 21,00 €, 55 €, $20, £8.50, CHF 12, 120 kr
export const MONEY_RE =
  /\d{1,5}(?:[.,]\d{1,2})?\s?(?:€|\$|£|CHF|EUR|USD|GBP|kr|zł|Kč|¥|₹|R\$|Fr\.)|(?:€|\$|£|US\$|R\$)\s?\d{1,5}(?:[.,]\d{1,2})?/g;
// International phone numbers
export const PHONE_RE = /\+\d[\d\s().-]{7,}\d/g;
// Date ranges: "6 juin au 28 septembre", "1. Juni bis 30. September", "June 6 to September 28"
export const DATE_RANGE_RE =
  /\b\d{1,2}(?:er|st|nd|rd|th|\.)?\s+\p{L}{3,}\.?\s+(?:au|to|bis|al|a|tot|até|jusqu'au|-|–)\s+(?:\d{1,2}\.?\s+)?\p{L}{3,}|\b\p{L}{3,}\s+\d{1,2}\s+(?:to|-|–)\s+\p{L}{3,}\s+\d{1,2}\b/giu;

const PATTERNS: readonly RegExp[] = [TIME_RE, MONEY_RE, PHONE_RE, DATE_RANGE_RE];

/** First opening period stated as a date range, or null. */
export function findDateRange(text: string | null | undefined): string | null {
  return text?.match(DATE_RANGE_RE)?.[0] ?? null;
}

interface Hit {
  index: number;
  length: number;
  kind: number;
}

function wordTrim(text: string, start: number, end: number): string {
  let s = start;
  let e = end;
  if (s > 0) {
    const firstSpace = text.indexOf(" ", s);
    if (firstSpace !== -1 && firstSpace < e) s = firstSpace + 1;
  }
  if (e < text.length) {
    const lastSpace = text.lastIndexOf(" ", e);
    if (lastSpace > s) e = lastSpace;
  }
  return text.slice(s, e).replace(/\s+/g, " ").trim();
}

/**
 * Up to `max` windows of text around the practical facts, the richest first
 * (a window holding both hours and a phone number beats one with a lone price).
 */
export function extractEvidence(text: string | null | undefined, max = 3): string[] {
  if (!text) return [];
  const hits: Hit[] = [];
  PATTERNS.forEach((pattern, kind) => {
    for (const match of text.matchAll(pattern)) {
      hits.push({ index: match.index, length: match[0].length, kind });
    }
  });
  hits.sort((a, b) => a.index - b.index);

  const windows: { start: number; end: number; kinds: Set<number> }[] = [];
  for (const hit of hits) {
    const current = windows[windows.length - 1];
    if (current && hit.index < current.end) {
      current.kinds.add(hit.kind);
      continue;
    }
    windows.push({
      start: Math.max(0, hit.index - HALF_WINDOW),
      end: Math.min(text.length, hit.index + hit.length + HALF_WINDOW),
      kinds: new Set([hit.kind]),
    });
  }

  return windows
    .sort((a, b) => b.kinds.size - a.kinds.size || a.start - b.start)
    .slice(0, max)
    .map((w) => wordTrim(text, w.start, w.end));
}

/**
 * Keep only the text around mentions of the place, so a page listing ten huts or
 * a hiking route only tells us about this one. Null when the place is never
 * named; the whole text when the name is made of generic words only.
 */
export function focusOnName(text: string, name: string, radius = 600): string | null {
  const words = foldAccents(name)
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length >= 3 && !GENERIC_NAME_WORDS.has(word))
    // "sports" must also match "sport": drop the last letter of longer words
    .map((word) => (word.length >= 5 ? word.slice(0, -1) : word));
  if (words.length === 0) return text;
  const folded = foldAccents(text);
  // Folding keeps the length for ordinary accents; otherwise cut the folded text itself
  const source = folded.length === text.length ? text : folded;
  const anchor = words.reduce((a, b) => (b.length > a.length ? b : a));
  const regions: [number, number][] = [];
  for (let at = folded.indexOf(anchor); at !== -1; at = folded.indexOf(anchor, at + 1)) {
    const start = Math.max(0, at - radius);
    const end = Math.min(source.length, at + anchor.length + radius);
    const region = folded.slice(start, end);
    if (!words.every((word) => region.includes(word))) continue;
    const last = regions[regions.length - 1];
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else regions.push([start, end]);
  }
  if (regions.length === 0) return null;
  return regions.map(([start, end]) => source.slice(start, end)).join(" … ");
}

function tokens(value: string): string[] {
  return value
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

function hopPriority(text: string, pathname: string): number {
  const words = [...tokens(text), ...tokens(pathname)];
  return HOP_LINK_STEMS.findIndex(({ stems }) =>
    words.some((word) => stems.some((stem) => word.startsWith(stem))),
  );
}

/**
 * Which linked pages to read after the homepage: same host, promising text or
 * slug (prices first, then hours, booking, menu, contact), two at most.
 */
export function pickHopLinks(
  links: readonly { text: string; href: string }[],
  baseUrl: string,
  max = 2,
): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const ranked: { href: string; priority: number }[] = [];
  const seen = new Set<string>([base.toString()]);
  for (const link of links) {
    let url: URL;
    try {
      url = new URL(link.href, base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.host !== base.host) continue;
    url.hash = "";
    const href = url.toString();
    if (seen.has(href)) continue;
    const priority = hopPriority(link.text, url.pathname);
    if (priority === -1) continue;
    seen.add(href);
    ranked.push({ href, priority });
  }
  return ranked
    .sort((a, b) => a.priority - b.priority)
    .slice(0, max)
    .map((r) => r.href);
}

/** Evidence windows of several pages as official-site snippets, round-robin so every page gets a say. */
export function buildEvidenceSnippets(
  pages: readonly { title: string | null; url: string; text: string | null | undefined }[],
  maxTotal = 4,
  engine = "official_website",
): SearchSnippet[] {
  const perPage = pages.map((page) => ({
    page,
    windows: extractEvidence(page.text, Math.min(3, maxTotal)),
  }));
  const snippets: SearchSnippet[] = [];
  for (let i = 0; snippets.length < maxTotal; i++) {
    const round = perPage.filter(({ windows }) => i < windows.length);
    if (round.length === 0) break;
    for (const { page, windows } of round) {
      if (snippets.length >= maxTotal) break;
      snippets.push({
        title: page.title ?? "Official site",
        url: page.url,
        content: windows[i],
        engine,
      });
    }
  }
  return snippets;
}
