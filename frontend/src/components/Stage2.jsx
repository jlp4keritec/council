import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDuration, shortModelName } from '../utils.js';

export default function Stage2({ results, metadata, stageDurationMs }) {
  const [active, setActive] = useState(0);
  if (!results || results.length === 0) return null;

  const { label_to_model = {}, aggregate_rankings = [] } = metadata || {};

  function deAnonymize(label) {
    const fullModel = label_to_model[label];
    if (!fullModel) return label;
    return `${label} → ${shortModelName(fullModel)}`;
  }

  // Liste rangee depuis le classement agrege (rang moyen, plus bas = meilleur)
  const ranked = [...aggregate_rankings].sort((a, b) => a.average_rank - b.average_rank);
  const n = ranked.length || 1;
  function barWidth(avgRank) {
    // meilleur rang (bas) => barre pleine
    const w = ((n - avgRank + 1) / n) * 100;
    return Math.max(12, Math.min(100, w));
  }

  const current = results[active];

  return (
    <section className="pane">
      <div className="pane-head">
        <div className="pane-head-row">
          <span className="stage-chip red"><span className="n">2</span>éval.</span>
          <h3>Classement</h3>
          {stageDurationMs != null && (
            <span className="pane-dur"><strong>{formatDuration(stageDurationMs)}</strong></span>
          )}
        </div>
        <span className="pane-sub">{results.length} évaluation{results.length > 1 ? 's' : ''} croisée{results.length > 1 ? 's' : ''}</span>
      </div>

      <div className="pane-body">
        <div className="ranked-crit">
          <strong>Classement agrégé</strong>
          Moyenne des positions reçues par chaque modèle — plus bas = meilleur.
        </div>

        {ranked.length > 0 ? (
          <div className="ranked-list">
            {ranked.map((a, i) => (
              <div key={a.model} className={`ranked-item ${i === 0 ? 'lead' : ''}`}>
                <div className="ranked-top">
                  <span className="ranked-pos">{i + 1}</span>
                  <span className="ranked-name">{shortModelName(a.model)}</span>
                  <span className="ranked-metric">{a.average_rank.toFixed(2)} <span>rang moy.</span></span>
                </div>
                <div className="ranked-bar"><i style={{ width: `${barWidth(a.average_rank)}%` }} /></div>
                <div className="ranked-count">
                  {a.rankings_count} évaluation{a.rankings_count > 1 ? 's' : ''}
                  {Array.isArray(a.raw_positions) && a.raw_positions.length > 0 && (
                    <> · positions [{a.raw_positions.join(', ')}]</>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="ranked-crit">Pas de classement agrégé disponible.</div>
        )}

        {/* Detail par evaluateur (replie) */}
        <details className="ranked-detail">
          <summary>Détail par évaluateur ({results.length})</summary>

          <div className="tabs" style={{ marginTop: 12 }}>
            {results.map((r, i) => (
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
                {r.parse_method === 'regex_fallback' && (
                  <span className="tab-badge tab-badge-fallback" title="Format JSON non respecté, fallback regex">fallback</span>
                )}
              </button>
            ))}
          </div>

          <div className="tab-content">
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
              Le modèle a vu les réponses anonymisées (Response A, B, …). Les vrais noms sont affichés ici uniquement pour ta lecture.
            </div>

            {current.parsed_ranking?.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <strong style={{ fontSize: 13 }}>Classement produit :</strong>
                <ol style={{ marginTop: 4, marginBottom: 0, paddingLeft: 20 }}>
                  {current.parsed_ranking.map((label) => (
                    <li key={label}>{deAnonymize(label)}</li>
                  ))}
                </ol>
              </div>
            )}

            {current.parsed_evaluations?.length > 0 ? (
              <div>
                <strong style={{ fontSize: 13 }}>Évaluations détaillées :</strong>
                {current.parsed_evaluations.map((ev) => (
                  <div key={ev.label} style={{ marginTop: 12 }}>
                    <div style={{ fontWeight: 600 }}>{deAnonymize(ev.label)}</div>
                    <div style={{ fontSize: 13, marginTop: 4 }}>
                      <strong style={{ color: 'var(--accent-hover)' }}>Points forts :</strong> {ev.strengths}
                    </div>
                    <div style={{ fontSize: 13, marginTop: 2 }}>
                      <strong style={{ color: 'var(--danger)' }}>Points faibles :</strong> {ev.weaknesses}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="markdown-content" style={{ marginTop: 8 }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {current.raw_response || ''}
                </ReactMarkdown>
              </div>
            )}
          </div>
        </details>
      </div>
    </section>
  );
}
