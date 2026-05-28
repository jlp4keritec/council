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
// Auth (v2.8) — mono-utilisateur
// ============================================================================
// L'app est protegee par un login simple.
// Username = ADMIN_USERNAME, Password = OPENROUTER_API_KEY.
// Une seule session active a la fois (mono-user). Cookie signe HMAC.

export const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
export const SESSION_DURATION_DAYS = parseInt(
  process.env.SESSION_DURATION_DAYS || '30',
  10,
);

// Secret serveur pour signer les sessions (multi-user v2.12).
// Par defaut derive de OPENROUTER_API_KEY pour rester stable sans config.
export const SESSION_SECRET = process.env.SESSION_SECRET || process.env.OPENROUTER_API_KEY || '';

// Longueur minimale du mot de passe a l'inscription.
export const PASSWORD_MIN_LENGTH = parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10);

// Cle maitre pour chiffrer les cles OpenRouter des utilisateurs.
// Si vide, on derive d'OPENROUTER_API_KEY (suffit en local, METTRE une valeur stable en prod).
export const OPENROUTER_KEYS_SECRET = process.env.OPENROUTER_KEYS_SECRET || '';

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
// Robustesse Council
// ============================================================================

export const COUNCIL_MIN_RESPONSES = parseInt(process.env.COUNCIL_MIN_RESPONSES || '3', 10);

export const COUNCIL_FALLBACK_POOL = parseCSV(process.env.COUNCIL_FALLBACK_POOL || '', [
  'deepseek/deepseek-chat-v3.1:free',
  'qwen/qwen3-235b-a22b:free',
  'openrouter/free',
  'openrouter/free',
]);

// ============================================================================
// Analyse du Chairman
// ============================================================================

export const CHAIRMAN_ANALYSIS_ENABLED =
  (process.env.CHAIRMAN_ANALYSIS_ENABLED || 'true').toLowerCase() !== 'false';

// ============================================================================
// Réseau / Robustesse
// ============================================================================

export const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT || '180000', 10);
export const TITLE_TIMEOUT = parseInt(process.env.TITLE_TIMEOUT || '30000', 10);

export const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '3', 10);
export const RETRY_BASE_DELAY = parseInt(process.env.RETRY_BASE_DELAY || '1500', 10);

export const RETRY_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

// ============================================================================
// Storage
// ============================================================================

export const DATA_DIR = process.env.DATA_DIR || 'data/conversations';

// Fichier JSON des comptes utilisateurs (multi-user v2.12).
export const USERS_FILE = process.env.USERS_FILE || 'data/users.json';

// ============================================================================
// Quota daily
// ============================================================================

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

// ============================================================================
// Grounding juridique (MCP) — utilisé par backend/retrieval.js
// ============================================================================
// DÉSACTIVÉ par défaut. Pour activer : mets GROUNDING_ENABLED=true dans .env
// puis remplis GROUNDING_MCP_URL (ex. https://dila.mesoutilsagile.com/mcp).
// retrieval.js est fail-open : si la config est vide ou si le MCP est en panne,
// la délibération continue normalement sans grounding.

export const GROUNDING_ENABLED =
  (process.env.GROUNDING_ENABLED || 'false').toLowerCase() === 'true';
export const GROUNDING_MCP_URL = process.env.GROUNDING_MCP_URL || '';
export const GROUNDING_MCP_TOOL = process.env.GROUNDING_MCP_TOOL || 'dila_search';
export const GROUNDING_MCP_QUERY_PARAM = process.env.GROUNDING_MCP_QUERY_PARAM || 'query';
export const GROUNDING_MCP_AUTH = process.env.GROUNDING_MCP_AUTH || '';
export const GROUNDING_MAX_RESULTS = parseInt(process.env.GROUNDING_MAX_RESULTS || '5', 10);
export const GROUNDING_TIMEOUT = parseInt(process.env.GROUNDING_TIMEOUT || '15000', 10);
export const GROUNDING_MAX_CHARS = parseInt(process.env.GROUNDING_MAX_CHARS || '6000', 10);

// ============================================================================
// Tagging par thème — utilisé par backend/council.js
// ============================================================================
// DÉSACTIVÉ par défaut. Active avec THEME_TAGGING_ENABLED=true et fournis un
// vocabulaire (CSV) via THEME_VOCAB. Si désactivé, le pipeline ignore les thèmes.

export const THEME_TAGGING_ENABLED =
  (process.env.THEME_TAGGING_ENABLED || 'false').toLowerCase() === 'true';
export const THEME_VOCAB = parseCSV(process.env.THEME_VOCAB, []);

// ============================================================================
// Leaderboard — utilisé par backend/leaderboard.js
// ============================================================================
// Fichier JSON où sont stockés les scores cumulés des modèles.

export const LEADERBOARD_FILE = process.env.LEADERBOARD_FILE || 'data/leaderboard.json';

// ============================================================================
// Cortex (second cerveau) — bouton « → Cortex »
// ============================================================================
// URL publique du serveur Cortex (sans /mcp final, ajouté automatiquement).
export const CORTEX_MCP_URL = process.env.CORTEX_MCP_URL || 'https://cortex.mesoutilsagile.com';
// Token statique MCP de Cortex (= MCP_TOKEN du .env de Cortex). Reste côté serveur.
export const CORTEX_MCP_TOKEN = process.env.CORTEX_MCP_TOKEN || '';
// Tags appliqués aux notes créées (CSV, minuscules, sans accents).
export const CORTEX_NOTE_TAGS = parseCSV(process.env.CORTEX_NOTE_TAGS, ['council', 'synthese-ia']);
