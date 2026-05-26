import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDuration, shortModelName } from '../utils.js';

export default function Stage1({ results, aggregateRankings, stageDurationMs, failedModels, attemptedFallback, reachedMinimum, minResponsesTarget }) {
  const [active, setActive] = useState(0);
  if (!results || results.length === 0) return null;

  const bestModel = aggregateRankings?.[0]?.model;
  const failed = Array.isArray(failedModels) ? failedModels : [];
  const fallbackUsed = Array.isArray(attemptedFallback) && attemptedFallback.length > 0;
  const fromFallbackCount = results.filter((r) => r.from_fallback).length;

  return (
    <section className="pane">
      <div className="pane-head">
        <div className="pane-head-row">
          <span className="stage-chip"><span className="n">1</span>conseil</span>
          <h3>Avis</h3>
          {stageDurationMs != null && (
            <span className="pane-dur"><strong>{formatDuration(stageDurationMs)}</strong></span>
          )}
        </div>
        <span className="pane-sub">{results.length} modèle{results.length > 1 ? 's' : ''} ont répondu</span>
      </div>

      <div className="pane-body">
        {failed.length > 0 && (
          <div className="stage-warning">
            ⚠ <strong>{failed.length} modèle{failed.length > 1 ? 's' : ''} n'a{failed.length > 1 ? 'nt' : ''} pas répondu</strong> :
            {' '}{failed.map(shortModelName).join(', ')}.
          </div>
        )}

        {fallbackUsed && (
          <div className="stage-info">
            ℹ {fromFallbackCount > 0 ? (
              <>
                <strong>{fromFallbackCount} substitution{fromFallbackCount > 1 ? 's' : ''} automatique{fromFallbackCount > 1 ? 's' : ''}</strong>
                {' '}depuis la fallback_pool pour atteindre le minimum de {minResponsesTarget} avis ({results.length} obtenu{results.length > 1 ? 's' : ''}, {reachedMinimum ? '✓ ok' : '✗ minimum non atteint'}).
                {' '}Modèles tentés : {attemptedFallback.map(shortModelName).join(', ')}.
              </>
            ) : (
              <>
                Fallback tenté ({attemptedFallback.map(shortModelName).join(', ')}) mais aucun n'a répondu.
                {' '}Minimum {minResponsesTarget} non atteint, {results.length} avis disponible{results.length > 1 ? 's' : ''}.
              </>
            )}
          </div>
        )}

        <div className="tabs">
          {results.map((r, i) => {
            const isBest = r.model === bestModel;
            return (
              <button
                key={r.model + i}
                className={`tab ${active === i ? 'active' : ''}`}
                onClick={() => setActive(i)}
                title={r.model}
              >
                {shortModelName(r.model)}
                {r.duration_ms != null && (
                  <span className="tab-duration">{formatDuration(r.duration_ms)}</span>
                )}
                {r.from_fallback && (
                  <span className="tab-badge tab-badge-fallback" title="Modèle ajouté automatiquement par le fallback pool">↻</span>
                )}
                {isBest && <span className="tab-badge tab-badge-best">#1</span>}
              </button>
            );
          })}
        </div>

        <div className="tab-content">
          <div className="markdown-content">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {results[active]?.response || ''}
            </ReactMarkdown>
          </div>
        </div>
      </div>
    </section>
  );
}
