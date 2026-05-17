import { useState, useEffect, useRef } from 'react';
import { api } from '../api.js';
import { formatDuration } from '../utils.js';
import Stage1 from './Stage1.jsx';
import Stage2 from './Stage2.jsx';
import Stage3 from './Stage3.jsx';

function MetricsBlock({ pricing, timings }) {
  if (!pricing && !timings) return null;
  const total = pricing?.total;

  return (
    <div className="metrics-block">
      {timings && (
        <div className="metrics-row">
          <strong>Temps :</strong>{' '}
          <span>Stage 1 <code>{formatDuration(timings.stage1_ms)}</code></span>
          {' · '}
          <span>Stage 2 <code>{formatDuration(timings.stage2_ms)}</code></span>
          {' · '}
          <span>Stage 3 <code>{formatDuration(timings.stage3_ms)}</code></span>
          {' · '}
          <strong>Total <code>{formatDuration(timings.total_ms)}</code></strong>
        </div>
      )}
      {total && (
        <div className="metrics-row">
          <strong>Tokens :</strong>{' '}
          {total.total_tokens.toLocaleString('fr-FR')}
          {' '}
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

export default function ChatInterface({ conversationId, onMessageSent, override }) {
  const [conversation, setConversation] = useState(null);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const [streamingMessage, setStreamingMessage] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!conversationId) {
      setConversation(null);
      return;
    }
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
      stage1: null,
      stage2: null,
      stage3: null,
      metadata: null,
      pricing: null,
      timings: null,
      stage1DurationMs: null,
      stage2DurationMs: null,
      stage3DurationMs: null,
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

      // Si erreur fatale pendant le streaming, on garde le streamingMessage
      // pour afficher l'erreur dans la conversation (sinon page blanche).
      const fresh = await api.getConversation(conversationId);
      setConversation(fresh);

      // On ne reset le streamingMessage QUE si le pipeline a vraiment abouti
      // (au moins un message assistant cree cote serveur). Sinon on garde
      // le streamingMessage avec son fatal_error pour que l'utilisateur voie quoi.
      setStreamingMessage((prev) => {
        if (!prev) return null;
        const lastMsg = fresh?.messages?.[fresh.messages.length - 1];
        if (lastMsg && lastMsg.role === 'assistant') {
          return null;   // message ok persiste cote serveur, on bascule sur fresh
        }
        // Erreur fatale ou rien : on conserve le streamingMessage avec l'erreur visible
        return prev;
      });
      onMessageSent?.();
    } catch (e) {
      console.error(e);
      setError(e.message || 'Erreur réseau');
    } finally {
      setStreaming(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!conversationId) {
    return (
      <div className="main">
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
    <div className="main">
      <div className="chat-messages">
        {allMessages.map((msg, i) => (
          <div key={i} className="message">
            {msg.role === 'user' ? (
              <div className="message-user markdown-content">{msg.content}</div>
            ) : (
              <AssistantMessage
                msg={msg}
                conversationId={conversationId}
                messageIndex={i}
              />
            )}
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {error && <div className="error-banner" style={{ margin: '0 20px' }}>{error}</div>}

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
            <button onClick={handleSend} disabled={!input.trim()}>
              Envoyer
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ msg, conversationId, messageIndex }) {
  const stage1Loading = !msg.stage1 && msg.currentStage === 'stage1_start';
  const stage2Loading = msg.stage1 && !msg.stage2 && (msg.currentStage === 'stage2_start' || msg.currentStage === 'stage1_complete');
  const stage3Loading = msg.stage2 && !msg.stage3 && (msg.currentStage === 'stage3_start' || msg.currentStage === 'stage2_complete');

  // Pour les messages persistes (rechargement de la conv), on lit timings depuis msg.timings
  const stage1Duration = msg.stage1DurationMs ?? msg.timings?.stage1_ms;
  const stage2Duration = msg.stage2DurationMs ?? msg.timings?.stage2_ms;
  const stage3Duration = msg.stage3DurationMs ?? msg.timings?.stage3_ms;

  // Le message est complet quand on a stage3 (= synthese finale produite)
  const isComplete = msg.stage3 && msg.stage3.response;

  // Erreur fatale (Stage 1 = 0 reponses, quota OpenRouter, etc.)
  if (msg.fatal_error) {
    return (
      <div className="message-assistant">
        <FatalErrorBlock
          message={msg.fatal_error}
          code={msg.fatal_error_code}
          recentErrors={msg.recent_errors}
        />
      </div>
    );
  }

  return (
    <div className="message-assistant">
      {isComplete && conversationId && messageIndex != null && (
        <ExportMenu conversationId={conversationId} messageIndex={messageIndex} />
      )}

      {stage1Loading && (
        <div className="stage-section">
          <div className="stage-title">
            Étape 1 — Opinions individuelles <span className="spinner" />
          </div>
        </div>
      )}
      <Stage1
        results={msg.stage1}
        aggregateRankings={msg.metadata?.aggregate_rankings}
        stageDurationMs={stage1Duration}
        failedModels={msg.failed_models_stage1 ?? msg.metadata?.failed_models_stage1}
        attemptedFallback={msg.attempted_fallback ?? msg.metadata?.attempted_fallback}
        reachedMinimum={msg.reached_minimum ?? msg.metadata?.reached_minimum}
        minResponsesTarget={msg.min_responses_target ?? msg.metadata?.min_responses_target}
      />

      {stage2Loading && (
        <div className="stage-section">
          <div className="stage-title">
            Étape 2 — Évaluation croisée <span className="spinner" />
          </div>
        </div>
      )}
      <Stage2
        results={msg.stage2}
        metadata={msg.metadata}
        stageDurationMs={stage2Duration}
      />

      {stage3Loading && (
        <div className="stage-section">
          <div className="stage-title">
            Étape 3 — Synthèse finale <span className="spinner" />
          </div>
        </div>
      )}
      <Stage3
        result={msg.stage3}
        stageDurationMs={stage3Duration}
      />

      <MetricsBlock pricing={msg.pricing} timings={msg.timings} />
    </div>
  );
}

function ExportMenu({ conversationId, messageIndex }) {
  const [copyStatus, setCopyStatus] = useState(null);   // null | 'copying' | 'copied' | 'error'

  async function handleCopyMarkdown() {
    setCopyStatus('copying');
    try {
      // Telecharge le MD via fetch puis copie dans le presse-papier
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
    const url = api.exportUrl(conversationId, format, messageIndex);
    // Le navigateur recoit Content-Disposition: attachment et telecharge
    window.location.href = url;
  }

  return (
    <div className="export-menu" title="Exporter cette réponse">
      <button
        className="export-btn"
        onClick={handleCopyMarkdown}
        disabled={copyStatus === 'copying'}
        title="Copier la synthèse complète en Markdown dans le presse-papier"
      >
        {copyStatus === 'copied' ? '✓ Copié' : copyStatus === 'error' ? '✗ Erreur' : '📋 Markdown'}
      </button>
      <button
        className="export-btn"
        onClick={() => handleDownload('md')}
        title="Télécharger en .md"
      >
        ⬇ .md
      </button>
      <button
        className="export-btn"
        onClick={() => handleDownload('json')}
        title="Télécharger les données brutes en JSON (audit-trail complet)"
      >
        ⬇ .json
      </button>
      <button
        className="export-btn export-btn-primary"
        onClick={() => handleDownload('docx')}
        title="Télécharger en Word (.docx) — livrable pour client/avocat"
      >
        ⬇ .docx
      </button>
      <button
        className="export-btn"
        onClick={() => handleDownload('pptx')}
        title="Télécharger en PowerPoint (.pptx) — présentation slides"
      >
        ⬇ .pptx
      </button>
    </div>
  );
}

/**
 * Bloc d'erreur fatale affiché à la place du message assistant quand
 * tous les modèles ont échoué (typiquement quota OpenRouter atteint).
 */
function FatalErrorBlock({ message, code, recentErrors }) {
  return (
    <div className="fatal-error-block">
      <div className="fatal-error-header">
        <span className="fatal-error-icon">⚠</span>
        <span className="fatal-error-title">Le Council n'a pas pu répondre</span>
        {code && <span className="fatal-error-code">{code}</span>}
      </div>
      <div className="fatal-error-message">
        {message.split('\n').map((line, i) => (
          <div key={i}>{line || '\u00A0'}</div>
        ))}
      </div>
      {code === 'quota_free_daily' && (
        <div className="fatal-error-cta">
          <button
            className="fatal-error-action"
            onClick={() => window.dispatchEvent(new CustomEvent('open-quota-help'))}
          >
            📖 Voir les options pour débloquer le quota
          </button>
        </div>
      )}
      {Array.isArray(recentErrors) && recentErrors.length > 0 && (
        <details className="fatal-error-details">
          <summary>Détail des erreurs ({recentErrors.length})</summary>
          <ul>
            {recentErrors.map((e, i) => (
              <li key={i}>
                <code>{e.model}</code> — HTTP {e.status} — <em>{e.code}</em>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
