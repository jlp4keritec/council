// Configuration globale du LLM Council.
// Toutes les valeurs sont surchargeables via variables d'environnement (.env).

import 'dotenv/config';

function parseCSV(value, fallback) {
  if (!value) return fallback;
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

// ============================================================================
// OpenRouter
// ============================================================================

export const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY || '';
export const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

export const OPENROUTER_HTTP_REFERER =
  process.env.OPENROUTER_HTTP_REFERER || 'https://council.mesoutilsagile.com';
export const OPENROUTER_X_TITLE = process.env.OPENROUTER_X_TITLE || 'LLM Council';

// ============================================================================
// Modèles
// ============================================================================

export const COUNCIL_MODELS = parseCSV(process.env.COUNCIL_MODELS, [
  'openai/gpt-5.1',
  'google/gemini-3-pro-preview',
  'anthropic/claude-sonnet-4.5',
  'x-ai/grok-4',
]);

// IMPORTANT — Chairman externe par defaut pour eviter le biais d'auto-preference.
// Si le chairman fait partie du council, il voit son propre nom en Stage 3
// (donnees deja desanonymisees a ce stade) et peut surponderer sa reponse.
// Fallback automatique sur COUNCIL_MODELS[0] si le chairman est indisponible.
export const CHAIRMAN_MODEL = process.env.CHAIRMAN_MODEL || 'anthropic/claude-opus-4.6';

export const TITLE_MODEL = process.env.TITLE_MODEL || 'google/gemini-2.5-flash';

// ============================================================================
// Critères d'évaluation Stage 2
// ============================================================================

export const EVAL_CRITERIA =
  process.env.EVAL_CRITERIA ||
  "précision factuelle, pertinence par rapport à la question, profondeur " +
  "d'analyse, clarté de la formulation.";

// ============================================================================
// Robustesse Council : pool de fallback + minimum de réponses
// ============================================================================
// Si moins de COUNCIL_MIN_RESPONSES modèles ont répondu en Stage 1, le système
// essaie automatiquement les modèles de COUNCIL_FALLBACK_POOL en série
// jusqu'à atteindre le minimum, ou jusqu'à épuisement du pool.

export const COUNCIL_MIN_RESPONSES = parseInt(process.env.COUNCIL_MIN_RESPONSES || '3', 10);

export const COUNCIL_FALLBACK_POOL = parseCSV(process.env.COUNCIL_FALLBACK_POOL || '', [
  'deepseek/deepseek-chat-v3.1:free',
  'qwen/qwen3-235b-a22b:free',
  'openrouter/free',
  'openrouter/free',
]);

// ============================================================================
// Analyse du Chairman (meta-cognitive : consensus/desaccords/arbitrage)
// ============================================================================
// Quand active, le Chairman produit un JSON {analysis, final_answer} qui
// permet d'afficher 2 onglets (Synthese + Analyse).
// Quand desactive, le Chairman renvoie juste du markdown comme avant
// (-~30-40% de tokens en sortie sur Stage 3, donc coute moins cher en payant).

export const CHAIRMAN_ANALYSIS_ENABLED = (process.env.CHAIRMAN_ANALYSIS_ENABLED || 'true').toLowerCase() !== 'false';

// ============================================================================
// Réseau / Robustesse
// ============================================================================

export const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '180000', 10);  // ms
export const TITLE_TIMEOUT = parseInt(process.env.TITLE_TIMEOUT || '30000', 10);

export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
export const RETRY_BASE_DELAY = parseInt(process.env.RETRY_BASE_DELAY || '1500', 10);  // ms

export const RETRY_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

// ============================================================================
// Storage
// ============================================================================

export const DATA_DIR = process.env.DATA_DIR || 'data/conversations';

// ============================================================================
// Quota daily (pour l'affichage sidebar)
// ============================================================================
// Realite OpenRouter mai 2026 :
//   - Sans credit depose : 50 req/jour de modeles :free => ~5 questions/jour
//     (car 1 question Council = ~10 appels OpenRouter)
//   - Avec 10$ deposes : 1000 req/jour => ~100 questions/jour
//   - Mode payant pur (modeles non-:free) : pas de limite per-day, juste $
//
// Default = 5 (mode free sans depot). Ajuste selon ta config OpenRouter :
//   DAILY_QUOTA_QUESTIONS=5      # free, sans credit (defaut)
//   DAILY_QUOTA_QUESTIONS=100    # free, avec 10$ deposes
//   DAILY_QUOTA_QUESTIONS=10000  # mode payant : desactive l'alerte
export const DAILY_QUOTA_QUESTIONS = parseInt(process.env.DAILY_QUOTA_QUESTIONS || '5', 10);

// ============================================================================
// CORS / Serveur
// ============================================================================

export const CORS_ORIGINS = parseCSV(process.env.CORS_ORIGINS, [
  'http://localhost:5180',
  'http://localhost:3000',
]);

export const HOST = process.env.HOST || '0.0.0.0';
export const PORT = parseInt(process.env.PORT || '8001', 10);
