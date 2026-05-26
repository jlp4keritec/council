import { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';
import { shortModelName } from '../utils.js';

// Presets rapides — 3 conseils a familles decorrelees (slugs :free verifies sur OpenRouter)
const PRESETS = {
  diversite: {
    label: 'Diversité max',
    hint: 'DeepSeek · Qwen · Meta · Z.ai — arbitre OpenAI',
    council_models: [
      'deepseek/deepseek-r1:free',
      'qwen/qwen3-235b-a22b:free',
      'meta-llama/llama-4-maverick:free',
      'z-ai/glm-4.5-air:free',
    ],
    chairman_model: 'openai/gpt-oss-120b:free',
    title_model: 'openai/gpt-oss-120b:free',
  },
  raisonnement: {
    label: 'Raisonnement',
    hint: 'DeepSeek V4 · Qwen · NVIDIA · Arcee — arbitre Meta',
    council_models: [
      'deepseek/deepseek-v4-flash:free',
      'qwen/qwen3-235b-a22b:free',
      'nvidia/nemotron-3-super-120b-a12b:free',
      'arcee-ai/trinity-large-thinking:free',
    ],
    chairman_model: 'meta-llama/llama-4-maverick:free',
    title_model: 'openai/gpt-oss-120b:free',
  },
  actuel: {
    label: 'Conseil actuel',
    hint: 'Tes 4 membres — arbitre GLM indépendant',
    council_models: [
      'deepseek/deepseek-r1:free',
      'qwen/qwen3-coder-480b:free',
      'meta-llama/llama-4-maverick:free',
      'openai/gpt-oss-120b:free',
    ],
    chairman_model: 'z-ai/glm-4.5-air:free',
    title_model: 'openai/gpt-oss-120b:free',
  },
};

export default function ModelSelector({ isOpen, onClose, currentOverride, serverDefaults, onApply }) {
  // Etat local de l'edition (separe de la prop pour permettre Cancel)
  const [councilModels, setCouncilModels] = useState([]);
  const [chairmanModel, setChairmanModel] = useState('');
  const [titleModel, setTitleModel] = useState('');
  const [evalCriteria, setEvalCriteria] = useState('');
  const [chairmanAnalysis, setChairmanAnalysis] = useState(true);

  // Recherche modeles
  const [searchInput, setSearchInput] = useState('');
  const [searchPricing, setSearchPricing] = useState('free');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchTarget, setSearchTarget] = useState(null);   // 'council' | 'chairman' | 'title' | null

  // Health check
  const [healthChecking, setHealthChecking] = useState(false);
  const [healthResults, setHealthResults] = useState(null);   // {results, summary} ou null

  // Init depuis currentOverride OU serverDefaults quand on ouvre
  useEffect(() => {
    if (!isOpen) return;
    const src = currentOverride || serverDefaults || {};
    setCouncilModels(src.council_models || serverDefaults?.council_models || []);
    setChairmanModel(src.chairman_model || serverDefaults?.chairman_model || '');
    setTitleModel(src.title_model || serverDefaults?.title_model || '');
    setEvalCriteria(src.eval_criteria || serverDefaults?.eval_criteria || '');
    // chairman_analysis : default true si non specifie
    const analysisValue = typeof src.chairman_analysis === 'boolean'
      ? src.chairman_analysis
      : (typeof serverDefaults?.chairman_analysis === 'boolean' ? serverDefaults.chairman_analysis : true);
    setChairmanAnalysis(analysisValue);
  }, [isOpen, currentOverride, serverDefaults]);

  // Recherche debounce 300ms
  useEffect(() => {
    if (!searchTarget) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await api.getModels({ search: searchInput, pricing: searchPricing, limit: 30 });
        setSearchResults(res.models || []);
      } catch (e) {
        console.error(e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchInput, searchPricing, searchTarget]);

  const addToCouncil = useCallback((modelId) => {
    setCouncilModels((prev) => {
      if (prev.includes(modelId)) return prev;
      if (prev.length >= 8) {
        alert('Maximum 8 modèles dans le Council');
        return prev;
      }
      return [...prev, modelId];
    });
  }, []);

  const removeFromCouncil = useCallback((modelId) => {
    setCouncilModels((prev) => {
      if (prev.length <= 2) {
        alert('Minimum 2 modèles dans le Council');
        return prev;
      }
      return prev.filter((m) => m !== modelId);
    });
  }, []);

  const applyPreset = useCallback((presetKey) => {
    const preset = PRESETS[presetKey];
    if (!preset) return;
    setCouncilModels([...preset.council_models]);
    setChairmanModel(preset.chairman_model);
    setTitleModel(preset.title_model);
  }, []);

  const resetToServerDefaults = useCallback(() => {
    setCouncilModels(serverDefaults?.council_models || []);
    setChairmanModel(serverDefaults?.chairman_model || '');
    setTitleModel(serverDefaults?.title_model || '');
    setEvalCriteria(serverDefaults?.eval_criteria || '');
  }, [serverDefaults]);

  /**
   * Ping les modeles du council + chairman pour verifier la dispo en temps reel.
   * Force le bypass du cache si forceRefresh.
   */
  const runHealthCheck = useCallback(async (forceRefresh = false) => {
    if (healthChecking) return;
    setHealthChecking(true);
    setHealthResults(null);
    try {
      // Construit la liste unique de modeles a tester (council + chairman + title)
      const allModels = Array.from(new Set([
        ...councilModels,
        chairmanModel,
        titleModel,
      ].filter(Boolean)));

      const res = await api.checkHealth(allModels, forceRefresh);
      setHealthResults(res);
    } catch (e) {
      console.error('Health check error:', e);
      setHealthResults({ error: e.message || 'Erreur reseau' });
    } finally {
      setHealthChecking(false);
    }
  }, [councilModels, chairmanModel, titleModel, healthChecking]);

  function handleApply() {
    // On envoie un override SEULEMENT si ca differe des defaults serveur
    const override = {};
    if (JSON.stringify(councilModels) !== JSON.stringify(serverDefaults?.council_models)) {
      override.council_models = councilModels;
    }
    if (chairmanModel !== serverDefaults?.chairman_model) {
      override.chairman_model = chairmanModel;
    }
    if (titleModel !== serverDefaults?.title_model) {
      override.title_model = titleModel;
    }
    if (evalCriteria !== serverDefaults?.eval_criteria) {
      override.eval_criteria = evalCriteria;
    }
    // chairman_analysis : on override si different du default serveur (true en general)
    const defaultAnalysis = typeof serverDefaults?.chairman_analysis === 'boolean'
      ? serverDefaults.chairman_analysis
      : true;
    if (chairmanAnalysis !== defaultAnalysis) {
      override.chairman_analysis = chairmanAnalysis;
    }
    onApply(Object.keys(override).length === 0 ? null : override);
    onClose();
  }

  function handleClearOverride() {
    onApply(null);
    onClose();
  }

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Configuration du Council</h2>
          <button className="modal-close" onClick={onClose} title="Fermer">×</button>
        </div>

        <div className="modal-body">
          {/* Presets */}
          <div className="config-section">
            <div className="config-section-title">Conseils prédéfinis</div>
            <div className="preset-buttons">
              {Object.entries(PRESETS).map(([key, p]) => (
                <button
                  key={key}
                  className="preset-btn"
                  onClick={() => applyPreset(key)}
                  title={p.hint}
                >
                  {p.label}
                  <small style={{ display: 'block', fontWeight: 400, opacity: 0.65, fontSize: '10px', marginTop: '2px' }}>
                    {p.hint}
                  </small>
                </button>
              ))}
              <button className="preset-btn preset-btn-reset" onClick={resetToServerDefaults}>
                Défaut (.env serveur)
              </button>
            </div>
          </div>

          {/* Health check */}
          <div className="config-section">
            <div className="config-section-title">
              Test disponibilité <span className="config-hint">— consomme 1 requête par modèle non-caché (cache 5 min)</span>
            </div>
            <div className="preset-buttons">
              <button
                className="preset-btn"
                onClick={() => runHealthCheck(false)}
                disabled={healthChecking || councilModels.length === 0}
              >
                {healthChecking ? '⏳ Test en cours...' : '🔍 Tester maintenant'}
              </button>
              {healthResults && (
                <button
                  className="preset-btn preset-btn-reset"
                  onClick={() => runHealthCheck(true)}
                  disabled={healthChecking}
                >
                  Forcer refresh (bypass cache)
                </button>
              )}
            </div>
            {healthResults?.summary && (
              <div className="health-summary">
                <span className="health-pill health-pill-up">🟢 {healthResults.summary.up} up</span>
                {healthResults.summary.rate_limited > 0 && (
                  <span className="health-pill health-pill-warn">🟠 {healthResults.summary.rate_limited} rate-limited</span>
                )}
                {healthResults.summary.unavailable > 0 && (
                  <span className="health-pill health-pill-down">🔴 {healthResults.summary.unavailable} down</span>
                )}
                {healthResults.summary.auth_error > 0 && (
                  <span className="health-pill health-pill-down">🔑 {healthResults.summary.auth_error} auth error</span>
                )}
                <span className="health-pill-info">sur {healthResults.summary.total} testés</span>
              </div>
            )}
            {healthResults?.error && (
              <div className="error-banner" style={{ marginTop: 8 }}>
                {healthResults.error}
              </div>
            )}
            {healthResults?.results && (
              <div className="health-list">
                {healthResults.results.map((r) => (
                  <div key={r.model} className={`health-row health-row-${r.status}`}>
                    <span className="health-icon">
                      {r.status === 'up' && '🟢'}
                      {r.status === 'rate_limited' && '🟠'}
                      {r.status === 'unavailable' && '🔴'}
                      {r.status === 'auth_error' && '🔑'}
                      {r.status === 'unknown' && '⚪'}
                    </span>
                    <span className="health-model" title={r.model}>{shortModelName(r.model)}</span>
                    <span className="health-id">{r.model}</span>
                    <span className="health-latency">{r.latency_ms} ms</span>
                    {r.cached && <span className="health-cached" title={`Cache ${Math.round(r.cache_age_ms / 1000)}s`}>cache</span>}
                    {r.error && <span className="health-error" title={r.error}>⚠</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Toggle analyse Chairman */}
          <div className="config-section">
            <label className="toggle-row">
              <input
                type="checkbox"
                checked={chairmanAnalysis}
                onChange={(e) => setChairmanAnalysis(e.target.checked)}
              />
              <div className="toggle-content">
                <div className="toggle-title">
                  Analyse méta-cognitive du Chairman
                  <span className="toggle-status">
                    {chairmanAnalysis ? '🟢 activée' : '⚪ désactivée'}
                  </span>
                </div>
                <div className="toggle-hint">
                  {chairmanAnalysis
                    ? "Le Chairman produit un JSON détaillé (consensus, désaccords, arbitrages) affiché dans l'onglet \"Analyse du Chairman\". Stage 3 ≈ 2× plus de tokens en sortie."
                    : "Le Chairman produit uniquement la synthèse finale en markdown. Pas d'onglet Analyse. Stage 3 ~ 30-40% moins coûteux en mode payant."}
                </div>
              </div>
            </label>
          </div>

          {/* Council members */}
          <div className="config-section">
            <div className="config-section-title">
              Council members ({councilModels.length}) <span className="config-hint">— min 2, max 8</span>
            </div>
            <div className="model-list">
              {councilModels.map((m) => (
                <div key={m} className="model-chip">
                  <span className="model-chip-name" title={m}>{shortModelName(m)}</span>
                  <span className="model-chip-id">{m}</span>
                  <button
                    className="model-chip-remove"
                    onClick={() => removeFromCouncil(m)}
                    title="Retirer"
                  >×</button>
                </div>
              ))}
              <button
                className="model-add-btn"
                onClick={() => setSearchTarget(searchTarget === 'council' ? null : 'council')}
              >
                {searchTarget === 'council' ? 'Fermer recherche' : '+ Ajouter un modèle'}
              </button>
            </div>
          </div>

          {/* Chairman */}
          <div className="config-section">
            <div className="config-section-title">
              Chairman <span className="config-hint">— synthèse finale, recommandé externe au Council</span>
            </div>
            <div className="model-list">
              <div className="model-chip">
                <span className="model-chip-name">{shortModelName(chairmanModel)}</span>
                <span className="model-chip-id">{chairmanModel}</span>
                {!councilModels.includes(chairmanModel) && chairmanModel && (
                  <span className="model-chip-badge" title="Externe au Council">externe</span>
                )}
              </div>
              <button
                className="model-add-btn"
                onClick={() => setSearchTarget(searchTarget === 'chairman' ? null : 'chairman')}
              >
                {searchTarget === 'chairman' ? 'Fermer' : 'Changer'}
              </button>
            </div>
          </div>

          {/* Title model (compact) */}
          <details className="config-section config-advanced">
            <summary>Modèle de génération de titres (optionnel)</summary>
            <div className="model-list">
              <div className="model-chip">
                <span className="model-chip-name">{shortModelName(titleModel)}</span>
                <span className="model-chip-id">{titleModel}</span>
              </div>
              <button
                className="model-add-btn"
                onClick={() => setSearchTarget(searchTarget === 'title' ? null : 'title')}
              >
                {searchTarget === 'title' ? 'Fermer' : 'Changer'}
              </button>
            </div>
          </details>

          {/* Search */}
          {searchTarget && (
            <div className="config-section search-section">
              <div className="config-section-title">
                Recherche modèle pour : {searchTarget === 'council' ? 'Council' : searchTarget === 'chairman' ? 'Chairman' : 'Titre'}
              </div>
              <div className="search-controls">
                <input
                  type="text"
                  className="search-input"
                  placeholder="Tape un nom (claude, gemini, qwen, deepseek…)"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  autoFocus
                />
                <select
                  className="search-pricing"
                  value={searchPricing}
                  onChange={(e) => setSearchPricing(e.target.value)}
                >
                  <option value="all">Tous</option>
                  <option value="free">Gratuits</option>
                  <option value="paid">Payants</option>
                </select>
              </div>
              <div className="search-results">
                {searching && <div className="search-loading">Recherche…</div>}
                {!searching && searchResults.length === 0 && (
                  <div className="search-empty">Aucun résultat. Tape un nom de modèle.</div>
                )}
                {!searching && searchResults.map((m) => (
                  <div key={m.id} className="search-result">
                    <div className="search-result-info">
                      <div className="search-result-name">{m.name}</div>
                      <div className="search-result-id">
                        {m.id}
                        {m.is_free && <span className="badge-free">FREE</span>}
                        {m.context_length > 0 && (
                          <span className="badge-context">{(m.context_length / 1000).toFixed(0)}K ctx</span>
                        )}
                      </div>
                    </div>
                    <button
                      className="search-result-add"
                      onClick={() => {
                        if (searchTarget === 'council') addToCouncil(m.id);
                        else if (searchTarget === 'chairman') setChairmanModel(m.id);
                        else if (searchTarget === 'title') setTitleModel(m.id);
                      }}
                    >
                      {searchTarget === 'council' ? '+' : 'Choisir'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Eval criteria */}
          <details className="config-section config-advanced">
            <summary>Critères d'évaluation Stage 2 (override .env)</summary>
            <textarea
              className="criteria-textarea"
              value={evalCriteria}
              onChange={(e) => setEvalCriteria(e.target.value)}
              rows={4}
              placeholder="Ex: Exactitude des références citées, pertinence de la qualification juridique…"
            />
          </details>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={handleClearOverride} title="Revient aux defaults .env du serveur">
            Reset complet
          </button>
          <div style={{ flex: 1 }} />
          <button className="btn-secondary" onClick={onClose}>Annuler</button>
          <button className="btn-primary" onClick={handleApply}>Appliquer</button>
        </div>
      </div>
    </div>
  );
}
