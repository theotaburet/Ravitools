import { Router } from "express";
import { isTimeoutError } from "../http.js";
import { enrichLimiter } from "../limiters.js";
import { log } from "../logger.js";
import { assertPublicHostname } from "../ssrf.js";
import { extractStructuredDataFromHtml } from "../structured-data.js";

export const fetchPageRouter = Router();

fetchPageRouter.post("/fetch-page", enrichLimiter, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };

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

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: "Only http/https URLs are supported" });
      return;
    }

    // SSRF guard — block private/internal IPs
    try {
      await assertPublicHostname(parsedUrl.hostname);
    } catch (err) {
      log.warn({ url, err }, "SSRF blocked: private IP detected");
      res.status(403).json({ error: "URL points to a private/internal address" });
      return;
    }

    // One shared 12s deadline across all redirect hops (AUDIT R25).
    const timeoutSignal = AbortSignal.timeout(12_000);

    // AUDIT R2: never let fetch() follow redirects itself — re-validate the
    // hostname of every hop so a public URL can't 302 into a private address.
    // ponytail: no IP pinning between lookup() and fetch() (DNS rebinding TOCTOU);
    // add an undici Agent with a pinned connect address if that threat matters.
    const REDIRECT_STATUSES = [301, 302, 303, 307, 308];
    const MAX_REDIRECT_HOPS = 3;
    let currentUrl = parsedUrl;
    let pageRes: Response;
    for (let hop = 0; ; hop++) {
      pageRes = await fetch(currentUrl.toString(), {
        method: "GET",
        redirect: "manual",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
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
      if (!["http:", "https:"].includes(currentUrl.protocol)) {
        res.status(400).json({ error: "Only http/https URLs are supported" });
        return;
      }
      try {
        await assertPublicHostname(currentUrl.hostname);
      } catch (err) {
        log.warn({ url: currentUrl.toString(), err }, "SSRF blocked: redirect to private IP");
        res.status(403).json({ error: "URL redirects to a private/internal address" });
        return;
      }
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
    const bodyText = normalized
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
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
