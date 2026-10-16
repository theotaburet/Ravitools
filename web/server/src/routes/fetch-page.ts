import { Router } from "express";
import { USER_AGENT } from "../config.js";
import { isTimeoutError } from "../http.js";
import { enrichLimiter } from "../limiters.js";
import { log } from "../logger.js";
import { assertPublicHostname } from "../ssrf.js";
import { extractStructuredDataFromHtml } from "../structured-data.js";

export const fetchPageRouter = Router();

/** Enough text for the client's evidence windows without shipping whole sites. */
const MAX_TEXT_CHARS = 20_000;
const MAX_LINKS = 200;

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** The handful of named and numeric entities that survive tag stripping. */
function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const num =
        code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(num) && num > 0 && num < 0x110000 ? String.fromCodePoint(num) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Same-host links (text + absolute href): the menu says where prices and hours live. */
function extractInternalLinks(html: string, pageUrl: string): { text: string; href: string }[] {
  const base = new URL(pageUrl);
  const seen = new Set<string>();
  const links: { text: string; href: string }[] = [];
  const capped = html.length > 2_000_000 ? html.slice(0, 2_000_000) : html;
  for (const match of capped.matchAll(/<a\s[^>]*?href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(match[1].replace(/&amp;/g, "&"), base);
    } catch {
      continue;
    }
    if (!/^https?:$/.test(url.protocol) || url.host !== base.host) continue;
    url.hash = "";
    const href = url.toString();
    if (seen.has(href) || links.length >= MAX_LINKS) continue;
    seen.add(href);
    links.push({
      text: match[2]
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim(),
      href,
    });
  }
  return links;
}

fetchPageRouter.post("/fetch-page", enrichLimiter, async (req, res) => {
  try {
    const { url } = (req.body ?? {}) as { url?: string };

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing 'url' in request body" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    // One shared 12s deadline across all redirect hops.
    const timeoutSignal = AbortSignal.timeout(12_000);

    // Never let fetch() follow redirects itself: validate the protocol and the
    // hostname of every hop (the first one included) so a public URL can't 302
    // into a private address.
    // No IP pinning between lookup() and fetch() (DNS rebinding TOCTOU);
    // add an undici Agent with a pinned connect address if that threat matters.
    const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
    const MAX_REDIRECT_HOPS = 3;
    let currentUrl = parsedUrl;
    let pageRes: Response;
    for (let hop = 0; ; hop++) {
      if (!["http:", "https:"].includes(currentUrl.protocol)) {
        res.status(400).json({ error: "Only http/https URLs are supported" });
        return;
      }
      try {
        await assertPublicHostname(currentUrl.hostname);
      } catch (err) {
        log.warn({ url: currentUrl.toString(), hop, err }, "SSRF blocked: private IP detected");
        res.status(403).json({ error: "URL points to a private/internal address" });
        return;
      }
      pageRes = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": USER_AGENT,
        },
        signal: timeoutSignal,
      });
      const location = pageRes.headers.get("location");
      if (!REDIRECT_STATUSES.includes(pageRes.status) || !location) break;
      if (hop >= MAX_REDIRECT_HOPS) {
        res.status(502).json({ error: "Too many redirects" });
        return;
      }
      currentUrl = new URL(location, currentUrl);
    }

    if (!pageRes.ok) {
      res.status(pageRes.status).json({
        error: "Website fetch error",
        status: pageRes.status,
      });
      return;
    }

    const contentType = pageRes.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      res.status(415).json({
        error: "Unsupported content type",
        contentType,
      });
      return;
    }

    const html = await pageRes.text();
    const normalized = html.replace(/\s+/g, " ").trim();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch =
      html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["'][^>]*>/i) ??
      html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["'][^>]*>/i);
    const bodyText = decodeEntities(
      normalized
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " "),
    )
      .replace(/\s+/g, " ")
      .trim();
    const structuredData = extractStructuredDataFromHtml(html);

    res.json({
      url: parsedUrl.toString(),
      finalUrl: pageRes.url,
      contentType,
      title: titleMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
      description:
        descriptionMatch?.[1]?.replace(/\s+/g, " ").trim() || structuredData?.description || null,
      excerpt: bodyText.slice(0, 1200) || null,
      text: bodyText.slice(0, MAX_TEXT_CHARS) || null,
      links: extractInternalLinks(html, pageRes.url || parsedUrl.toString()),
      structuredData,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      res.status(504).json({ error: "Website fetch timed out" });
      return;
    }
    log.error({ err }, "Website fetch proxy error");
    res.status(502).json({ error: "Failed to fetch website" });
  }
});
