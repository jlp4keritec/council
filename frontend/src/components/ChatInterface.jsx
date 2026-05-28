import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { formatDuration } from '../utils.js';
import Stage1 from './Stage1.jsx';
import Stage2 from './Stage2.jsx';
import Stage3 from './Stage3.jsx';

const VIEW_KEY = 'council-view';
function loadView() {
  try { return localStorage.getItem(VIEW_KEY) === 'lecture' ? 'lecture' : 'tableau'; }
  catch { return 'tableau'; }
}

/* Barre de metriques pleine largeur sous le board (temps + tokens + cout) */
function MetricsBlock({ pricing, timings }) {
  if (!pricing && !timings) return null;
  const total = pricing?.total;
  return (
    <div className="metrics-block">
      {timings && (
        <div className="metrics-row">
          <strong>Temps :</strong>{' '}
          <span>Stage 1 <code>{formatDuration(timings.stage1_ms)}</code></span>{' · '}
          <span>Stage 2 <code>{formatDuration(timings.stage2_ms)}</code></span>{' · '}
          <span>Stage 3 <code>{formatDuration(timings.stage3_ms)}</code></span>{' · '}
          <strong>Total <code>{formatDuration(timings.total_ms)}</code></strong>
        </div>
      )}
      {total && (
        <div className="metrics-row">
          <strong>Tokens :</strong>{' '}
          {total.total_tokens.toLocaleString('fr-FR')}{' '}
          <span style={{ color: 'var(--text-secondary)' }}>
            ({total.total_prompt_tokens} in / {total.total_completion_tokens} out)
          </span>
          {total.total_cost_usd != null && (
            <> {' — '}<strong>${total.total_cost_usd.toFixed(4)}</strong></>
          )}
          {total.total_cost_usd == null && total.total_tokens > 0 && (
            <> {' — '} coût non fourni par OpenRouter pour certains modèles</>
          )}
        </div>
      )}
    </div>
  );
}

/* Panneau squelette (chargement / en attente) — garde la grille a 3 colonnes stable */
function PaneSkeleton({ n, title, tinted, loading }) {
  return (
    <section className={`pane pane-skeleton ${tinted ? 'pane-chairman' : ''}`}>
      <div className={`pane-head ${tinted ? 'tinted-blue' : ''}`}>
        <div className="pane-head-row">
          <span className={`stage-chip ${n === 2 ? 'red' : ''}`}><span className="n">{n}</span>{n === 1 ? 'conseil' : n === 2 ? 'éval.' : 'chairman'}</span>
          <h3>{title}</h3>
        </div>
      </div>
      <div className="pane-body">
        {loading ? (<><span className="spinner" /> En cours…</>) : 'En attente…'}
      </div>
    </section>
  );
}

export default function ChatInterface({ conversationId, onMessageSent, override, hasKey, onOpenAccount }) {
  const [conversation, setConversation] = useState(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const [view, setView] = useState(loadView);
  const messagesEndRef = useRef(null);

  function changeView(v) {
    setView(v);
    try { localStorage.setItem(VIEW_KEY, v); } catch { /* ignore */ }
  }

  useEffect(() => {
    if (!conversationId) { setConversation(null); return; }
    api.getConversation(conversationId).then(setConversation).catch(console.error);
    setStreamingMessage(null);
    setError(null);
  }, [conversationId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages?.length, streamingMessage]);

  async function handleSend() {
    const content = input.trim();
    if (!content || streaming || !conversationId) return;

    setStreaming(true);
    setError(null);
    setInput('');

    setConversation((c) => ({
      ...c,
      messages: [...(c?.messages || []), { role: 'user', content }],
    }));

    const inProgress = {
      role: 'assistant',
      stage1: null, stage2: null, stage3: null,
      metadata: null, pricing: null, timings: null,
      stage1DurationMs: null, stage2DurationMs: null, stage3DurationMs: null,
      failed_models_stage1: null,
      currentStage: 'stage1_start',
    };
    setStreamingMessage(inProgress);

    try {
      await api.sendMessageStream(conversationId, content, (event) => {
        setStreamingMessage((prev) => {
          if (!prev) return prev;
          const next = { ...prev, currentStage: event.type };
          switch (event.type) {
            case 'stage1_complete':
              next.stage1 = event.data;
              next.stage1DurationMs = event.duration_ms;
              next.failed_models_stage1 = event.failed_models || [];
              next.attempted_fallback = event.attempted_fallback || [];
              next.reached_minimum = event.reached_minimum;
              next.min_responses_target = event.min_responses_target;
              break;
            case 'stage2_complete':
              next.stage2 = event.data;
              next.metadata = event.metadata;
              next.stage2DurationMs = event.duration_ms;
              break;
            case 'stage3_complete':
              next.stage3 = event.data;
              next.stage3DurationMs = event.duration_ms;
              break;
            case 'title_complete':
              onMessageSent?.(event.data.title);
              break;
            case 'complete':
              next.pricing = event.pricing;
              next.timings = event.timings;
              break;
            case 'error':
              setError(event.message);
              next.fatal_error = event.message;
              next.fatal_error_code = event.error_code;
              next.recent_errors = event.recent_errors;
              break;
          }
          return next;
        });
      }, override);

      const fresh = await api.getConversation(conversationId);
      setConversation(fresh);
      setStreamingMessage((prev) => {
        if (!prev) return null;
        const lastMsg = fresh?.messages?.[fresh.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') return null;
        return prev;
      });
      onMessageSent?.();
    } catch (e) {
      console.error(e);
      // 403 no_api_key : l'utilisateur n'a pas encore mis sa cle OpenRouter
      const msg = String(e?.message || '');
      if (msg.includes('API 403') || /no_api_key/i.test(msg)) {
        setError('🔑 Pour utiliser le Council, ajoute ta clé OpenRouter dans « Mon compte » (en bas à gauche).');
      } else {
        setError(msg || 'Erreur réseau');
      }
      // Nettoie le message "en cours" qui n'a rien produit
      setStreamingMessage(null);
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }

  if (!conversationId) {
    return (
      <div className={`main mode-${view}`}>
        <div className="welcome">
          <h2>Bienvenue dans LLM Council</h2>
          <p>Sélectionne une conversation ou crée-en une nouvelle.</p>
        </div>
      </div>
    );
  }

  const messages = conversation?.messages || [];
  const allMessages = streamingMessage ? [...messages, streamingMessage] : messages;

  return (
    <div className={`main mode-${view}`}>
      <div className="main-header">
        <div className="main-header-title">
          {conversation?.title || <span className="muted">Nouvelle conversation</span>}
        </div>
        <div className="viewtoggle" role="group" aria-label="Disposition">
          <button
            className={view === 'lecture' ? 'active' : ''}
            onClick={() => changeView('lecture')}
            title="Lecture — une colonne"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="14" y2="17"/></svg>
            Lecture
          </button>
          <button
            className={view === 'tableau' ? 'active' : ''}
            onClick={() => changeView('tableau')}
            title="Tableau — trois panneaux"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="4" width="5" height="16" rx="1"/><rect x="9.5" y="4" width="5" height="16" rx="1"/><rect x="16" y="4" width="5" height="16" rx="1"/></svg>
            Tableau
          </button>
        </div>
      </div>

      <div className="chat-messages">
        {allMessages.map((msg, i) => (
          <div key={i} className="message">
            {msg.role === 'user' ? (
              <div className="message-user">{msg.content}</div>
            ) : (
              <AssistantMessage msg={msg} conversationId={conversationId} messageIndex={i} />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {hasKey === false && (
        <div
          style={{
            margin: '12px 24px 0', padding: '10px 14px', borderRadius: 8,
            background: '#fff5e6', border: '1px solid #f3e0c2', color: '#a06010',
            fontSize: 13, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
          }}
        >
          <span>🔑 Pour utiliser le Council, ajoute ta clé OpenRouter dans <strong>Mon compte</strong>.</span>
          <button
            onClick={() => onOpenAccount?.()}
            style={{
              padding: '6px 12px', fontSize: 12, fontWeight: 600,
              background: '#a06010', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Aller à Mon compte
          </button>
        </div>
      )}

      {error && <div className="error-banner" style={{ margin: '0 24px' }}>{error}</div>}

      {streaming ? (
        <div className="pipeline-status-bar">
          <span className="spinner" />
          <span className="pipeline-status-text">
            Council en cours de réflexion… Patiente jusqu'à la fin du pipeline pour poser une nouvelle question.
          </span>
        </div>
      ) : (
        <div className="chat-input-area">
          <div className="chat-input">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pose ta question au Council… (Entrée pour envoyer, Maj+Entrée pour nouvelle ligne)"
            />
            <button onClick={handleSend} disabled={!input.trim()}>Envoyer</button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ msg, conversationId, messageIndex }) {
  const stage1Duration = msg.stage1DurationMs ?? msg.timings?.stage1_ms;
  const stage2Duration = msg.stage2DurationMs ?? msg.timings?.stage2_ms;
  const stage3Duration = msg.stage3DurationMs ?? msg.timings?.stage3_ms;

  const isComplete = msg.stage3 && msg.stage3.response;

  if (msg.fatal_error) {
    return (
      <div className="message-assistant">
        <FatalErrorBlock message={msg.fatal_error} code={msg.fatal_error_code} recentErrors={msg.recent_errors} />
      </div>
    );
  }

  // Etats de chargement par stage (squelettes pour garder 3 colonnes stables)
  const s1Loading = !msg.stage1 && msg.currentStage === 'stage1_start';
  const s2Loading = msg.stage1 && !msg.stage2 && (msg.currentStage === 'stage2_start' || msg.currentStage === 'stage1_complete');
  const s3Loading = msg.stage2 && !msg.stage3 && (msg.currentStage === 'stage3_start' || msg.currentStage === 'stage2_complete');

  return (
    <div className="message-assistant">
      {isComplete && conversationId && messageIndex != null && (
        <ExportMenu conversationId={conversationId} messageIndex={messageIndex} />
      )}

      <div className="board">
        {/* Panneau 1 — Conseil */}
        {msg.stage1 ? (
          <Stage1
            results={msg.stage1}
            aggregateRankings={msg.metadata?.aggregate_rankings}
            stageDurationMs={stage1Duration}
            failedModels={msg.failed_models_stage1 ?? msg.metadata?.failed_models_stage1}
            attemptedFallback={msg.attempted_fallback ?? msg.metadata?.attempted_fallback}
            reachedMinimum={msg.reached_minimum ?? msg.metadata?.reached_minimum}
            minResponsesTarget={msg.min_responses_target ?? msg.metadata?.min_responses_target}
          />
        ) : (
          <PaneSkeleton n={1} title="Avis" loading={s1Loading} />
        )}

        {/* Panneau 2 — Classement */}
        {msg.stage2 ? (
          <Stage2 results={msg.stage2} metadata={msg.metadata} stageDurationMs={stage2Duration} />
        ) : (
          <PaneSkeleton n={2} title="Classement" loading={s2Loading} />
        )}

        {/* Panneau 3 — Synthèse */}
        {msg.stage3 && msg.stage3.response ? (
          <Stage3 result={msg.stage3} stageDurationMs={stage3Duration} />
        ) : (
          <PaneSkeleton n={3} title="Synthèse" tinted loading={s3Loading} />
        )}
      </div>

      <MetricsBlock pricing={msg.pricing} timings={msg.timings} />
    </div>
  );
}

function ExportMenu({ conversationId, messageIndex }) {
  const [copyStatus, setCopyStatus] = useState(null);
  const [cortexStatus, setCortexStatus] = useState(null);

  async function handleCopyMarkdown() {
    setCopyStatus('copying');
    try {
      const url = api.exportUrl(conversationId, 'md', messageIndex);
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const md = await res.text();
      await navigator.clipboard.writeText(md);
      setCopyStatus('copied');
      setTimeout(() => setCopyStatus(null), 2000);
    } catch (e) {
      console.error('Copy markdown failed:', e);
      setCopyStatus('error');
      setTimeout(() => setCopyStatus(null), 3000);
    }
  }

  function handleDownload(format) {
    window.location.href = api.exportUrl(conversationId, format, messageIndex);
  }

  async function handleSendToCortex() {
    setCortexStatus('sending');
    try {
      await api.sendToCortex(conversationId, messageIndex);
      setCortexStatus('sent');
      setTimeout(() => setCortexStatus(null), 3000);
    } catch (e) {
      console.error('Envoi Cortex échoué:', e);
      setCortexStatus('error');
      setTimeout(() => setCortexStatus(null), 4000);
    }
  }

  return (
    <div className="export-menu" title="Exporter cette réponse">
      <button className="export-btn" onClick={handleCopyMarkdown} disabled={copyStatus === 'copying'}
        title="Copier la synthèse complète en Markdown">
        {copyStatus === 'copied' ? '✓ Copié' : copyStatus === 'error' ? '✗ Erreur' : '📋 Markdown'}
      </button>
      <button className="export-btn" onClick={() => handleDownload('md')} title="Télécharger en .md">⬇ .md</button>
      <button className="export-btn" onClick={() => handleDownload('json')} title="Télécharger les données brutes en JSON">⬇ .json</button>
      <button className="export-btn export-btn-primary" onClick={() => handleDownload('docx')} title="Télécharger en Word (.docx)">⬇ .docx</button>
      <button className="export-btn" onClick={() => handleDownload('pptx')} title="Télécharger en PowerPoint (.pptx)">⬇ .pptx</button>
      <button
        className="export-btn"
        onClick={handleSendToCortex}
        disabled={cortexStatus === 'sending'}
        title="Envoyer cette délibération dans Cortex (arrive dans inbox/)"
      >
        {cortexStatus === 'sending' ? '… envoi'
          : cortexStatus === 'sent' ? '✓ dans Cortex'
          : cortexStatus === 'error' ? '✗ échec'
          : '🧠 → Cortex'}
      </button>
    </div>
  );
}

function FatalErrorBlock({ message, code, recentErrors }) {
  return (
    <div className="fatal-error-block">
      <div className="fatal-error-header">
        <span className="fatal-error-icon">⚠</span>
        <span className="fatal-error-title">Le Council n'a pas pu répondre</span>
        {code && <span className="fatal-error-code">{code}</span>}
      </div>
      <div className="fatal-error-message">
        {message.split('\n').map((line, i) => (<div key={i}>{line || '\u00A0'}</div>))}
      </div>
      {code === 'quota_free_daily' && (
        <div className="fatal-error-cta">
          <button className="fatal-error-action" onClick={() => window.dispatchEvent(new CustomEvent('open-quota-help'))}>
            📖 Voir les options pour débloquer le quota
          </button>
        </div>
      )}
      {Array.isArray(recentErrors) && recentErrors.length > 0 && (
        <details className="fatal-error-details">
          <summary>Détail des erreurs ({recentErrors.length})</summary>
          <ul>
            {recentErrors.map((e, i) => (
              <li key={i}><code>{e.model}</code> — HTTP {e.status} — <em>{e.code}</em></li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
