// --- POI detail (design.md 7, 02 POI): it replaces the list and is the only place a POI's
// detail shows. ◀ ▶ walk the filtered list in route order (the pipeline sorts along the trace).

import { useAtom, useAtomValue } from "jotai";
import { ArrowLeft, ChevronLeft, ChevronRight, ExternalLink } from "lucide";
import { useEffect, useRef } from "react";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { osmFacts } from "../lib/enrichment/osm-facts";
import { isRetryableDegradedResult } from "../lib/enrichment/provenance";
import { getAvailabilityTags, splitHoursLines } from "../lib/export";
import { km } from "../lib/format";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { CATEGORY_FAMILIES, FAMILY_COLORS, poiGlyph } from "../lib/poi-config";
import { enrichingPoiIdsAtom } from "../state/enrichment";
import { enrichmentsAtom, filteredPoisAtom } from "../state/route";
import { paletteAtom, selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";
import { EnrichmentDetails, EnrichmentSummary } from "./EnrichmentDetails";
import { Icon } from "./Icon";

export function PoiDetail() {
  const pois = useAtomValue(filteredPoisAtom);
  const [selectedId, select] = useAtom(selectedPoiIdAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const enrichingPoiIds = useAtomValue(enrichingPoiIdsAtom);
  const palette = useAtomValue(paletteAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const headingRef = useRef<HTMLHeadingElement>(null);

  const index = pois.findIndex((p) => p.id === selectedId);
  const poi = index >= 0 ? pois[index] : undefined;

  // Focus moves to the heading when the detail opens; ◀ ▶ keep it on themselves
  const open = poi !== undefined;
  useEffect(() => {
    if (open) headingRef.current?.focus();
  }, [open]);

  if (!poi) return null;

  const enrichment = enrichments.get(poi.id);
  const done = enrichment?.status === "done" ? enrichment : undefined;
  const { fill, glyph } = FAMILY_COLORS[palette][CATEGORY_FAMILIES[poi.category]];
  const state = [
    ...getAvailabilityTags(done?.hours ?? null, poi.tags.opening_hours, lang),
    ...osmFacts(poi.tags, lang),
  ];
  // OSM hours when the enrichment brought none
  const osmHours = !done?.openingHours?.length && !done?.hours ? poi.tags.opening_hours : undefined;

  return (
    <article className="poi-detail" aria-labelledby="poi-detail-name">
      <div className="poi-detail-bar">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => select(null)}>
          <Icon node={ArrowLeft} size={18} />
          {t("poi.backToList", lang)}
        </button>
        <span className="micro poi-detail-pos">
          {index + 1} / {pois.length}
        </span>
        <button
          type="button"
          className="btn btn-sm"
          aria-label={t("poi.prev", lang)}
          disabled={index === 0}
          onClick={() => select(pois[index - 1].id)}
        >
          <Icon node={ChevronLeft} />
        </button>
        <button
          type="button"
          className="btn btn-sm"
          aria-label={t("poi.next", lang)}
          disabled={index === pois.length - 1}
          onClick={() => select(pois[index + 1].id)}
        >
          <Icon node={ChevronRight} />
        </button>
      </div>

      <header className="poi-detail-head">
        <span className="pastille pastille-lg" style={{ background: fill, color: glyph }}>
          <Icon node={poiGlyph(poi)} />
        </span>
        <div>
          <h2 id="poi-detail-name" ref={headingRef} tabIndex={-1}>
            {translatePoiName(poi.name, lang)}
          </h2>
          <p className="poi-detail-category">{translateCategory(poi.category, lang)}</p>
        </div>
      </header>

      <p className="micro">
        KM {km(poi.alongTraceDistance)} · {Math.round(poi.distanceToTrace)} M{" "}
        {t("poi.fromRoute", lang)}
      </p>

      {state.length > 0 && <p className="poi-detail-state">{state.join(" · ")}</p>}
      {enrichingPoiIds?.has(poi.id) && !done && (
        <p className="poi-detail-state">
          <span className="spinner-sm" /> {t("poi.searching", lang)}
        </p>
      )}

      {done && <EnrichmentSummary enrichment={done} targetLanguage={lang} />}
      {enrichment?.status === "skipped" && enrichment.skipReason && (
        <p className="poi-skip-reason">
          {t(`poi.skip.${enrichment.skipReason}`, lang)}
          {isRetryableDegradedResult(enrichment) ? t("poi.skipRetryable", lang) : ""}
        </p>
      )}

      {(done || osmHours) && (
        <details className="poi-detail-more">
          <summary className="micro">{t("poi.more", lang)}</summary>
          {osmHours && (
            <p className="poi-enrichment-meta-preline">{splitHoursLines(osmHours).join("\n")}</p>
          )}
          {done && <EnrichmentDetails enrichment={done} targetLanguage={lang} />}
        </details>
      )}

      <a
        className="btn btn-quiet"
        href={enrichment?.googleMapsUrl ?? buildGoogleMapsUrl(poi)}
        target="_blank"
        rel="noopener noreferrer"
      >
        Google Maps <Icon node={ExternalLink} size={16} />
      </a>
    </article>
  );
}
