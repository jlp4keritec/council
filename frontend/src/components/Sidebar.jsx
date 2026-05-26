import { useEffect, useState } from 'react';
import { api } from '../api.js';
import { formatDateTooltip } from '../utils.js';

const MAX_SLOTS = 20;

// Cle localStorage utilisee par ModelSelector pour stocker l override.
const COUNCIL_OVERRIDE_KEY = 'llm-council-config-override';

function readCouncilOverride() {
  try {
    const raw = localStorage.getItem(COUNCIL_OVERRIDE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function fetchUsageWithOverride() {
  const override = readCouncilOverride();
  const params = new URLSearchParams();
  if (override?.council_models?.length) {
    params.set('council_models', override.council_models.join(','));
  }
  if (override?.chairman_model) {
    params.set('chairman_model', override.chairman_model);
  }
  if (override?.title_model) {
    params.set('title_model', override.title_model);
  }
  const qs = params.toString();
  if (!qs) return api.getUsage();
  const res = await fetch(`/api/usage?${qs}`, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function refreshOpenRouterStatus() {
  try {
    await fetch('/api/usage/refresh', { method: 'POST', credentials: 'include' });
  } catch (_err) { /* silencieux */ }
}

export default function Sidebar({
  activeId, onSelect, onNew,
  onOpenConfig, onOpenQuotaHelp,
  refreshKey, hasOverride,
  authUser, onLogout,
}) {
  const [conversations, setConversations] = useState([]);
  const [config, setConfig] = useState(null);
  const [usage, setUsage] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(console.error);
    fetchUsageWithOverride().then(setUsage).catch(console.error);
  }, [refreshKey, hasOverride]);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(console.error);
  }, []);

  async function handleRefreshStatus(e) {
    e.stopPropagation();
    setRefreshing(true);
    await refreshOpenRouterStatus();
    try {
      const fresh = await fetchUsageWithOverride();
      setUsage(fresh);
    } catch (_err) { /* silencieux */ }
    setRefreshing(false);
  }

  async function handleDelete(e, id) {
    e.stopPropagation();
    if (!confirm('Supprimer cette conversation ?')) return;
    await api.deleteConversation(id);
    const updated = await api.listConversations();
    setConversations(updated);
    if (activeId === id) onSelect(null);
  }

  function handleLogoutClick() {
    if (!confirm('Se déconnecter ?')) return;
    onLogout?.();
  }

  const visibleConvs = conversations.slice(0, MAX_SLOTS);
  const slots = Array.from({ length: MAX_SLOTS }, (_, i) => ({
    index: i + 1,
    conv: visibleConvs[i] || null,
  }));

  const quotaMode = usage?.quota?.mode || 'unknown';
  const quotaLimit = usage?.quota?.limit;
  const showProgressBar = usage?.quota?.show_progress_bar ?? true;
  const questionsToday = usage?.questions_today || 0;
  const quotaPercent = quotaLimit != null && quotaLimit > 0
    ? Math.min(100, Math.round((questionsToday / quotaLimit) * 100))
    : 0;
  const quotaReached = quotaLimit != null && questionsToday >= quotaLimit;
  const quotaWarning = !quotaReached && quotaPercent >= 80;
  const isPaidMode = quotaMode === 'paid_or_mixed';

  const modeBadge = {
    free_no_credit: { text: 'Free · sans credit', cls: 'quota-badge-free' },
    free_with_credit: { text: 'Free · credit depose', cls: 'quota-badge-credit' },
    paid_or_mixed: { text: 'Mode payant', cls: 'quota-badge-paid' },
    unknown: { text: 'Statut OpenRouter inconnu', cls: 'quota-badge-warn' },
  }[quotaMode];

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

      {/* Bloc quota dynamique */}
      {usage && (
        <div
          className={`sidebar-quota ${
            quotaReached ? 'quota-reached' : quotaWarning ? 'quota-warning' : ''
          } ${isPaidMode ? 'sidebar-quota-paid' : ''}`}
          onClick={onOpenQuotaHelp}
          title="Cliquer pour voir les options de quota OpenRouter"
          style={{ cursor: 'pointer' }}
        >
          <div className="sidebar-quota-header">
            <span>Quota du jour</span>
            {isPaidMode ? (
              <strong>{questionsToday} <span className="sidebar-quota-unit">questions</span></strong>
            ) : (
              <strong>{questionsToday} / {quotaLimit ?? '?'}</strong>
            )}
          </div>

          {!isPaidMode && showProgressBar && (
            <div className="sidebar-quota-bar">
              <div
                className="sidebar-quota-bar-fill"
                style={{ width: `${Math.min(100, quotaPercent)}%` }}
              />
            </div>
          )}

          <div className="sidebar-quota-mode-info">
            {modeBadge && (
              <span className={`quota-badge ${modeBadge.cls}`}>{modeBadge.text}</span>
            )}
            <button
              className="sidebar-quota-refresh-btn"
              onClick={handleRefreshStatus}
              disabled={refreshing}
              title="Re-verifier le statut OpenRouter (apres depot de credit)"
            >
              {refreshing ? '...' : '⟳'}
            </button>
          </div>

          {quotaReached && (
            <div className="sidebar-quota-alert">⚠ Quota atteint — clique pour les options</div>
          )}
          {quotaWarning && !quotaReached && (
            <div className="sidebar-quota-alert sidebar-quota-warning-text">
              ⚠ Plus que {quotaLimit - questionsToday} question{quotaLimit - questionsToday > 1 ? 's' : ''} — clique pour aide
            </div>
          )}
          {!quotaReached && !quotaWarning && !isPaidMode && (
            <div className="sidebar-quota-help-link">? Voir les options de quota</div>
          )}
          {isPaidMode && (
            <div className="sidebar-quota-help-link sidebar-quota-paid-info">
              Modeles payants : pas de quota free per-day
            </div>
          )}
        </div>
      )}

      <div className="sidebar-config">
        <button className="sidebar-config-btn" onClick={onOpenConfig}>
          <span>⚙ Configuration</span>
          {hasOverride && <span className="sidebar-config-badge" title="Override actif">●</span>}
        </button>
      </div>

      {(config || true) && (
        <div className="sidebar-footer">
          {config && (
            <div>{config.council_models.length} modèles · chairman {config.chairman_is_external ? '(externe)' : '(membre)'}</div>
          )}
          {hasOverride && <div className="sidebar-override-notice">Override actif (⚙)</div>}
          <div
            className="sidebar-version"
            onClick={() => window.dispatchEvent(new CustomEvent('open-about'))}
            title="À propos / changelog"
            style={{ marginTop: 6, cursor: 'pointer', fontFamily: "'Geist Mono', monospace", fontSize: 10, opacity: 0.7 }}
          >
            LLM Council v{__APP_VERSION__}
          </div>
        </div>
      )}

      {/* Bandeau user + logout (v2.8) */}
      {(authUser || onLogout) && (
        <div className="sidebar-auth">
          <div className="sidebar-auth-user">
            <span className="sidebar-auth-dot"></span>
            <span className="sidebar-auth-name">{authUser || 'Connecté'}</span>
          </div>
          <button
            className="sidebar-auth-logout"
            onClick={handleLogoutClick}
            title="Se déconnecter"
          >
            Déconnexion
          </button>
        </div>
      )}
    </div>
  );
}
