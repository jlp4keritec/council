import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTooltip } from '../utils.js';

const MAX_SLOTS = 20;

export default function Sidebar({ activeId, onSelect, onNew, onOpenConfig, onOpenQuotaHelp, refreshKey, hasOverride }) {
  const [conversations, setConversations] = useState([]);
  const [config, setConfig] = useState(null);
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(console.error);
    api.getUsage().then(setUsage).catch(console.error);
  }, [refreshKey]);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
  }, []);

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm('Supprimer cette conversation ?')) return;
    await api.deleteConversation(id);
    const updated = await api.listConversations();
    setConversations(updated);
    if (activeId === id) onSelect(null);
  }

  // Limite a MAX_SLOTS conversations affichees (les + recentes)
  // listConversations() renvoie deja les + recentes en premier
  const visibleConvs = conversations.slice(0, MAX_SLOTS);

  // Construit 20 slots : remplis avec les conversations, vides apres
  const slots = Array.from({ length: MAX_SLOTS }, (_, i) => ({
    index: i + 1,
    conv: visibleConvs[i] || null,
  }));

  // Quota status -> styling
  const quotaPercent = usage?.percent_used || 0;
  const quotaReached = usage && usage.remaining === 0;
  const quotaWarning = !quotaReached && quotaPercent >= 80;

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>LLM Council</h1>
        <button
          className="sidebar-new-btn"
          onClick={onNew}
          disabled={quotaReached}
          title={quotaReached ? 'Quota atteint pour aujourd\'hui' : 'Nouvelle question au Council'}
        >
          + Nouvelle
        </button>
      </div>

      <div className="sidebar-list-fixed">
        {slots.map(({ index, conv }) => {
          const slotNum = String(index).padStart(2, '0');
          if (!conv) {
            return (
              <div key={`empty-${index}`} className="sidebar-slot sidebar-slot-empty">
                <span className="sidebar-slot-num">{slotNum}</span>
                <span className="sidebar-slot-title">—</span>
              </div>
            );
          }
          return (
            <div
              key={conv.id}
              className={`sidebar-slot ${activeId === conv.id ? 'active' : ''}`}
              onClick={() => onSelect(conv.id)}
              title={formatDateTooltip(conv.created_at)}
            >
              <span className="sidebar-slot-num">{slotNum}</span>
              <span className="sidebar-slot-title">{conv.title}</span>
              <button
                className="sidebar-slot-delete"
                onClick={(e) => handleDelete(e, conv.id)}
                title="Supprimer"
              >×</button>
            </div>
          );
        })}
      </div>

      {/* Bloc quota */}
      {usage && (
        <div
          className={`sidebar-quota ${quotaReached ? 'quota-reached' : quotaWarning ? 'quota-warning' : ''}`}
          onClick={onOpenQuotaHelp}
          title="Cliquer pour voir les options de quota OpenRouter"
          style={{ cursor: 'pointer' }}
        >
          <div className="sidebar-quota-header">
            <span>Quota du jour</span>
            <strong>{usage.questions_today} / {usage.quota_daily}</strong>
          </div>
          <div className="sidebar-quota-bar">
            <div
              className="sidebar-quota-bar-fill"
              style={{ width: `${Math.min(100, quotaPercent)}%` }}
            />
          </div>
          {quotaReached && (
            <div className="sidebar-quota-alert">⚠ Quota atteint — clique pour les options</div>
          )}
          {quotaWarning && !quotaReached && (
            <div className="sidebar-quota-alert sidebar-quota-warning-text">
              ⚠ Plus que {usage.remaining} question{usage.remaining > 1 ? 's' : ''} — clique pour aide
            </div>
          )}
          {!quotaReached && !quotaWarning && (
            <div className="sidebar-quota-help-link">? Voir les options de quota</div>
          )}
        </div>
      )}

      <div className="sidebar-config">
        <button className="sidebar-config-btn" onClick={onOpenConfig}>
          <span>⚙ Configuration</span>
          {hasOverride && <span className="sidebar-config-badge" title="Override actif">●</span>}
        </button>
      </div>

      {config && (
        <div className="sidebar-footer">
          <div>{config.council_models.length} modèles · chairman {config.chairman_is_external ? '(externe)' : '(membre)'}</div>
          {hasOverride && <div className="sidebar-override-notice">Override actif (⚙)</div>}
        </div>
      )}
    </div>
  );
}
