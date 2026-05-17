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

  const current = results[active];

  return (
    <div className="stage-section">
      <div className="stage-title">
        Étape 2 — Évaluation croisée
        {stageDurationMs != null && (
          <span className="stage-duration">{formatDuration(stageDurationMs)}</span>
        )}
      </div>

      {aggregate_rankings.length > 0 && (
        <div className="tab-content" style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 }}>
            <strong>Classement agrégé</strong> — moyenne des positions reçues par chaque modèle (plus bas = meilleur)
          </div>
          <table className="aggregate-table">
            <thead>
              <tr>
                <th>Modèle</th>
                <th>Rang moyen</th>
                <th>Positions reçues</th>
                <th>Nb d'évaluations</th>
              </tr>
            </thead>
            <tbody>
              {aggregate_rankings.map((a) => (
                <tr key={a.model}>
                  <td>{shortModelName(a.model)}</td>
                  <td>{a.average_rank.toFixed(2)}</td>
                  <td>[{a.raw_positions?.join(', ')}]</td>
                  <td>{a.rankings_count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tabs">
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
              <span className="tab-badge" title="Format JSON non respecté, fallback regex">
                fallback
              </span>
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
                <div style={{ fontWeight: 500 }}>{deAnonymize(ev.label)}</div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  <strong style={{ color: '#198754' }}>Points forts :</strong> {ev.strengths}
                </div>
                <div style={{ fontSize: 13, marginTop: 2 }}>
                  <strong style={{ color: '#dc3545' }}>Points faibles :</strong> {ev.weaknesses}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 13, color: 'var(--text-secondary)' }}>
              Voir la réponse brute du modèle
            </summary>
            <div className="markdown-content" style={{ marginTop: 8 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {current.raw_response || ''}
              </ReactMarkdown>
            </div>
          </details>
        )}
      </div>
    </div>
  );
}
