import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { formatDuration, shortModelName } from '../utils.js';

export default function Stage3({ result, stageDurationMs }) {
  const [active, setActive] = useState('synthesis');
  if (!result || !result.response) return null;

  const hasAnalysis = result.analysis && typeof result.analysis === 'object';

  return (
    <section className="pane pane-chairman">
      <div className="pane-head tinted-blue">
        <div className="pane-head-row">
          <span className="stage-chip"><span className="n">3</span>chairman</span>
          <h3>Synthèse</h3>
          {stageDurationMs != null && (
            <span className="pane-dur"><strong>{formatDuration(stageDurationMs)}</strong></span>
          )}
        </div>
        <span className="pane-sub">
          arbitrée par {shortModelName(result.model)}
          {result.used_fallback && (
            <span className="fallback-tag" title="Chairman principal indisponible, fallback automatique">fallback</span>
          )}
          {result.parse_method === 'fallback_text' && (
            <span className="fallback-tag" title="Le modèle n'a pas respecté le format JSON, analyse non disponible">raw</span>
          )}
        </span>
      </div>

      <div className="pane-body">
        {hasAnalysis && (
          <div className="tabs">
            <button
              className={`tab ${active === 'synthesis' ? 'active' : ''}`}
              onClick={() => setActive('synthesis')}
            >
              Synthèse
            </button>
            <button
              className={`tab ${active === 'analysis' ? 'active' : ''}`}
              onClick={() => setActive('analysis')}
            >
              Analyse du Chairman
              <span className="tab-badge tab-badge-analysis" title="Raisonnement méta-cognitif">↗</span>
            </button>
          </div>
        )}

        {active === 'synthesis' && (
          <div className="tab-content chairman">
            <div className="markdown-content">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {result.response}
              </ReactMarkdown>
            </div>
          </div>
        )}

        {active === 'analysis' && hasAnalysis && (
          <div className="tab-content chairman-analysis">
            <ChairmanAnalysis analysis={result.analysis} />
          </div>
        )}
      </div>
    </section>
  );
}

function ChairmanAnalysis({ analysis }) {
  const consensus = Array.isArray(analysis.consensus_points) ? analysis.consensus_points : [];
  const disagreements = Array.isArray(analysis.disagreements) ? analysis.disagreements : [];
  const rejected = Array.isArray(analysis.rejected_arguments) ? analysis.rejected_arguments : [];
  const weighting = typeof analysis.weighting_rationale === 'string' ? analysis.weighting_rationale : '';

  const hasAnything = consensus.length > 0 || disagreements.length > 0 || rejected.length > 0 || weighting;

  if (!hasAnything) {
    return (
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
        Le Chairman n'a pas produit d'analyse détaillée pour cette question.
      </div>
    );
  }

  return (
    <div className="analysis-sections">
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
        Voici le raisonnement méta-cognitif du Chairman : ce qu'il a observé dans les réponses du Council et comment il a tranché.
      </div>

      {consensus.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">
            <span className="analysis-icon analysis-icon-consensus">✓</span>
            Points de consensus
            <span className="analysis-count">{consensus.length}</span>
          </div>
          <ul className="analysis-list">
            {consensus.map((point, i) => (<li key={i}>{point}</li>))}
          </ul>
        </div>
      )}

      {disagreements.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">
            <span className="analysis-icon analysis-icon-disagreement">⚖</span>
            Désaccords arbitrés
            <span className="analysis-count">{disagreements.length}</span>
          </div>
          <div className="analysis-disagreements">
            {disagreements.map((d, i) => (
              <div key={i} className="analysis-disagreement">
                <div className="analysis-disagreement-topic"><strong>Sujet :</strong> {d.topic}</div>
                {d.positions && (
                  <div className="analysis-disagreement-positions"><strong>Positions :</strong> {d.positions}</div>
                )}
                {d.my_arbitration && (
                  <div className="analysis-disagreement-arbitration"><strong>Arbitrage :</strong> {d.my_arbitration}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="analysis-section">
          <div className="analysis-section-title">
            <span className="analysis-icon analysis-icon-rejected">✗</span>
            Arguments écartés
            <span className="analysis-count">{rejected.length}</span>
          </div>
          <ul className="analysis-list">
            {rejected.map((arg, i) => (<li key={i}>{arg}</li>))}
          </ul>
        </div>
      )}

      {weighting && (
        <div className="analysis-section">
          <div className="analysis-section-title">
            <span className="analysis-icon analysis-icon-weighting">⚖️</span>
            Pondération des modèles
          </div>
          <div className="analysis-weighting">{weighting}</div>
        </div>
      )}
    </div>
  );
}
