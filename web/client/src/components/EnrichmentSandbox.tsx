import { useEffect, useMemo, useState } from "react";
import type { EnrichedData, POI, TargetLanguage } from "../types";
import { enrichPoi, getOfficialWebsiteUrl } from "../lib/enrichment";

interface Props {
  pois: POI[];
  targetLanguage: TargetLanguage;
}

function isSandboxCandidate(poi: POI): boolean {
  return ["Restaurant or Bar", "Food shop", "Sleeping place", "Gears"].includes(poi.category) && poi.name.trim().length > 0;
}

export function EnrichmentSandbox({ pois, targetLanguage }: Props) {
  const candidates = useMemo(() => pois.filter(isSandboxCandidate), [pois]);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [result, setResult] = useState<EnrichedData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedPoiId && candidates[0]) {
      setSelectedPoiId(candidates[0].id);
    }
  }, [candidates, selectedPoiId]);

  const selectedPoi = candidates.find((poi) => poi.id === selectedPoiId) ?? null;

  async function runSandbox() {
    if (!selectedPoi) return;
    setLoading(true);
    setError(null);
    try {
      const enriched = await enrichPoi(selectedPoi, {
        apiBase: "/api",
        targetLanguage,
        policyOverride: "full",
      });
      setResult(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown sandbox error");
      setResult(null);
    } finally {
      setLoading(false);
    }
  }

  if (candidates.length === 0) return null;

  return (
    <section className="sandbox-panel">
      <div className="sandbox-header">
        <div>
          <h3>Enrichment Sandbox</h3>
          <p className="sandbox-subtitle">Real POI from current GPX, raw fetches, and final structured output.</p>
        </div>
        <button className="neo-btn-sm neo-btn-pink" onClick={runSandbox} disabled={!selectedPoi || loading}>
          {loading ? "Inspecting..." : "Run sandbox"}
        </button>
      </div>

      <div className="sandbox-controls">
        <label className="sandbox-field">
          <span>POI</span>
          <select value={selectedPoiId ?? ""} onChange={(e) => setSelectedPoiId(e.target.value)}>
            {candidates.map((poi) => (
              <option key={poi.id} value={poi.id}>{poi.name} · {poi.category}</option>
            ))}
          </select>
        </label>
      </div>

      {selectedPoi && (
        <div className="sandbox-poi-meta">
          <span className="neo-tag">{selectedPoi.category}</span>
          <span>{selectedPoi.name}</span>
          <span className="sandbox-muted">{selectedPoi.distanceToTrace.toFixed(0)} m from route</span>
          {getOfficialWebsiteUrl(selectedPoi) && <a className="poi-source-link" href={getOfficialWebsiteUrl(selectedPoi)!} target="_blank" rel="noreferrer">official site</a>}
        </div>
      )}

      {error && <div className="error-box"><p>{error}</p></div>}

      {result && (
        <div className="sandbox-grid">
          <div className="sandbox-card">
            <h4>Compact LLM Output</h4>
            <div className="sandbox-facts">
              <span>Rating: {result.rating != null ? `${result.rating.toFixed(1)}/5` : "n/a"}</span>
              <span>Reviews: {result.reviewCount ?? "n/a"}</span>
              <span>Price: {result.priceLevel != null ? "$".repeat(result.priceLevel) : "n/a"}</span>
              <span>Confidence: {(result.confidence * 100).toFixed(0)}%</span>
              <span>Source: {result.synthesisSource ?? "unknown"}</span>
              <span>Reason: {result.synthesisReason ?? "none"}</span>
            </div>
            <div className="sandbox-block">
              <strong>Description</strong>
              <p>{result.description ?? "None"}</p>
            </div>
            <div className="sandbox-block">
              <strong>Review</strong>
              <p>{result.review ?? "None"}</p>
            </div>
            <div className="sandbox-block">
              <strong>Opening Hours</strong>
              {result.openingHours && result.openingHours.length > 0 ? (
                <table className="poi-hours-table">
                  <tbody>
                    {result.openingHours.map((entry, i) => (
                      <tr key={i}>
                        <td className="poi-hours-day">{entry.day}</td>
                        <td className="poi-hours-time">
                          {entry.open === "closed" ? "Closed" : `${entry.open}–${entry.close ?? ""}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <p>{result.hours ?? "None"}</p>
              )}
            </div>

            {/* Legacy structured fields (when present from older enrichments) */}
            {result.structured && (
              <>
                <div className="sandbox-block">
                  <strong>Cautions</strong>
                  {result.structured.cautions.length ? (
                    <ul className="sandbox-list">
                      {result.structured.cautions.map((item, index) => <li key={`caution-${index}`}>{item}</li>)}
                    </ul>
                  ) : <p>None</p>}
                </div>
                <div className="sandbox-block">
                  <strong>Divergences</strong>
                  {result.structured.divergences.length ? (
                    <ul className="sandbox-list sandbox-divergences">
                      {result.structured.divergences.map((item, index) => <li key={`div-${index}`}>{item}</li>)}
                    </ul>
                  ) : <p>None</p>}
                </div>
                <div className="sandbox-block">
                  <strong>Source Rollup</strong>
                  {result.structured.sourceRollup.length ? (
                    <ul className="sandbox-list">
                      {result.structured.sourceRollup.map((digest, index) => (
                        <li key={`rollup-${index}`}>
                          <span className="sandbox-platform">{digest.platform}</span>
                          <span>{digest.brief}</span>
                          {digest.url && <a className="poi-source-link" href={digest.url} target="_blank" rel="noreferrer">link</a>}
                        </li>
                      ))}
                    </ul>
                  ) : <p>None</p>}
                </div>
                <div className="sandbox-block">
                  <strong>Source Confirmation</strong>
                  <p>{result.structured.sourceConfirmation ?? "none"}</p>
                </div>
              </>
            )}

            {/* Deprecated fields (backward compat display) */}
            {(result.summary || result.specialty || result.essentials) && (
              <div className="sandbox-block" style={{ opacity: 0.5 }}>
                <strong>Legacy Fields</strong>
                <p>summary: {result.summary ?? "—"}</p>
                <p>specialty: {result.specialty ?? "—"}</p>
                <p>essentials: {result.essentials ?? "—"}</p>
              </div>
            )}
          </div>

          <div className="sandbox-card">
            <h4>Website Fetch</h4>
            {result.officialWebsite ? (
              <>
                <div className="sandbox-block"><strong>Title</strong><p>{result.officialWebsite.title ?? "None"}</p></div>
                <div className="sandbox-block"><strong>Description</strong><p>{result.officialWebsite.description ?? "None"}</p></div>
                <div className="sandbox-block"><strong>Excerpt</strong><p>{result.officialWebsite.excerpt ?? "None"}</p></div>
              </>
            ) : (
              <p className="sandbox-muted">No working official website fetched.</p>
            )}
          </div>

          <div className="sandbox-card sandbox-card-wide">
            <h4>Raw Search Snippets</h4>
            {result.searchQuery && (
              <div className="sandbox-block">
                <strong>Search Query</strong>
                <code className="sandbox-query">{result.searchQuery}</code>
              </div>
            )}
            {result.geoContext && (
              <div className="sandbox-block">
                <strong>Geo Context</strong>
                <span className="sandbox-muted">
                  {[result.geoContext.locality, result.geoContext.county, result.geoContext.state, result.geoContext.country].filter(Boolean).join(" > ")}
                  {result.geoContext.countryCode ? ` (${result.geoContext.countryCode.toUpperCase()})` : ""}
                </span>
              </div>
            )}
            {result.rawSnippets.length > 0 ? (
              <ul className="sandbox-list">
                {result.rawSnippets.map((snippet, index) => (
                  <li key={`${snippet.url}-${index}`}>
                    <a className="poi-source-link" href={snippet.url} target="_blank" rel="noreferrer">{snippet.title || snippet.url}</a>
                    <span className="sandbox-muted">[{snippet.engine}]</span>
                    <p>{snippet.content}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sandbox-muted">No snippets.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
