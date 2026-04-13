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
            <h4>Structured Output</h4>
            <div className="sandbox-block"><strong>Essentials</strong><p>{result.essentials ?? "None"}</p></div>
            <div className="sandbox-block"><strong>Headline</strong><p>{result.structured?.headline ?? "None"}</p></div>
            <div className="sandbox-block"><strong>Operational summary</strong><p>{result.structured?.operationalSummary ?? "None"}</p></div>
            <div className="sandbox-block"><strong>Summary</strong><p>{result.translatedSummary ?? result.summary ?? "None"}</p></div>
            <div className="sandbox-facts">
              <span>Rating: {result.rating != null ? `${result.rating.toFixed(1)}/5` : "n/a"}</span>
              <span>Reviews: {result.reviewCount ?? "n/a"}</span>
              <span>Hours: {result.hours ?? "n/a"}</span>
              <span>Specialty: {result.specialty ?? "n/a"}</span>
            </div>
            <div className="sandbox-block">
              <strong>Practicalities</strong>
              {result.structured?.practicalities.length ? (
                <ul className="sandbox-list">
                  {result.structured.practicalities.map((item, index) => <li key={`practical-${index}`}>{item}</li>)}
                </ul>
              ) : <p>None</p>}
            </div>
            <div className="sandbox-block">
              <strong>Source Digests (legacy)</strong>
              {result.sourceDigests && result.sourceDigests.length > 0 ? (
                <ul className="sandbox-list">
                  {result.sourceDigests.map((digest, index) => (
                    <li key={`${digest.platform}-${index}`}>
                      <span className="sandbox-platform">{digest.platform}</span>
                      <span>{digest.brief}</span>
                    </li>
                  ))}
                </ul>
              ) : <p>None — see Source Rollup below</p>}
            </div>
            <div className="sandbox-block">
              <strong>Cautions</strong>
              {result.structured?.cautions.length ? (
                <ul className="sandbox-list">
                  {result.structured.cautions.map((item, index) => <li key={`caution-${index}`}>{item}</li>)}
                </ul>
              ) : <p>None</p>}
            </div>
            <div className="sandbox-block">
              <strong>Divergences</strong>
              {result.structured?.divergences.length ? (
                <ul className="sandbox-list sandbox-divergences">
                  {result.structured.divergences.map((item, index) => <li key={`div-${index}`}>{item}</li>)}
                </ul>
              ) : <p>None</p>}
            </div>
            <div className="sandbox-block">
              <strong>Unknowns</strong>
              {result.structured?.unknowns.length ? (
                <ul className="sandbox-list">
                  {result.structured.unknowns.map((item, index) => <li key={`unk-${index}`}>{item}</li>)}
                </ul>
              ) : <p>None</p>}
            </div>
            <div className="sandbox-block">
              <strong>Source Rollup</strong>
              {result.structured?.sourceRollup.length ? (
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
              <p>{result.structured?.sourceConfirmation ?? "none"}</p>
            </div>
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
