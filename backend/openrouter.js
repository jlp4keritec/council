// Client OpenRouter avec retry exponentiel + tracking pricing.
// Utilise fetch natif (Node 20+) et AbortController pour le timeout.

import {
  OPENROUTER_API_KEY,
  OPENROUTER_API_URL,
  OPENROUTER_HTTP_REFERER,
  OPENROUTER_X_TITLE,
  REQUEST_TIMEOUT,
  MAX_RETRIES,
  RETRY_BASE_DELAY,
  RETRY_STATUS_CODES,
} from './config.js';
import { extractUsage } from './pricing.js';

function buildHeaders(apiKey) {
  const key = apiKey || OPENROUTER_API_KEY;
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    // Optionnels mais visibles dans le dashboard OpenRouter
    'HTTP-Referer': OPENROUTER_HTTP_REFERER,
    'X-Title': OPENROUTER_X_TITLE,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelay(attempt) {
  // Backoff exponentiel avec jitter. attempt = 0 pour le 1er retry.
  const base = RETRY_BASE_DELAY * Math.pow(2, attempt);
  const jitter = Math.random() * base * 0.3;
  return base + jitter;
}

// ============================================================================
// Ring buffer des erreurs recentes par modele
// ============================================================================
// Permet au serveur de diagnostiquer les patterns d'echec (ex: quota free
// epuise, rate limit, auth, etc.) pour formuler un message d'erreur clair.

const MODEL_ERROR_LOG_SIZE = 100;
const modelErrorLog = [];   // [{model, status, code, message, timestamp}, ...]

function categorizeError(text, status) {
  const t = (text || '').toLowerCase();
  if (t.includes('free-models-per-day') || t.includes('free model requests per day')) {
    return 'quota_free_daily';
  }
  if (status === 429) return 'rate_limit';
  if (status === 404 && t.includes('no endpoints found')) return 'no_endpoints';
  if (status === 401 || status === 403) return 'auth';
  if (status === 402) return 'insufficient_credit';
  return 'unknown';
}

function recordModelError(model, status, text) {
  modelErrorLog.push({
    model,
    status,
    code: categorizeError(text, status),
    message: (text || '').slice(0, 250),
    timestamp: Date.now(),
  });
  if (modelErrorLog.length > MODEL_ERROR_LOG_SIZE) {
    modelErrorLog.splice(0, modelErrorLog.length - MODEL_ERROR_LOG_SIZE);
  }
}

/**
 * Retourne les erreurs enregistrees depuis un timestamp donne (ms).
 */
export function getRecentModelErrors(sinceTimestamp = 0) {
  return modelErrorLog.filter((e) => e.timestamp >= sinceTimestamp);
}

/**
 * Appelle un modele OpenRouter avec retry et tracking usage.
 *
 * @param {string} model              identifiant OpenRouter (ex: "openai/gpt-5.1")
 * @param {Array<{role,content}>} messages
 * @param {object} options
 * @param {number} options.timeout    timeout en ms par tentative
 * @param {object} options.responseFormat  ex: {type: "json_object"}
 * @param {number} options.maxRetries
 * @returns {Promise<{model, content, usage} | null>}
 */
export async function queryModel(model, messages, options = {}) {
  const {
    timeout = REQUEST_TIMEOUT,
    responseFormat = null,
    maxRetries = MAX_RETRIES,
    apiKey = null,
  } = options;

  const effectiveKey = apiKey || OPENROUTER_API_KEY;
  if (!effectiveKey) {
    console.error('Aucune cle OpenRouter disponible (ni utilisateur, ni .env)');
    return null;
  }

  const payload = {
    model,
    messages,
    // Force OpenRouter a inclure le cout dans usage. Cle, sans ca on
    // n'a que les tokens et il faudrait maintenir une table de prix.
    usage: { include: true },
  };

  if (responseFormat !== null) {
    payload.response_format = responseFormat;
  }

  const headers = buildHeaders(effectiveKey);
  let lastError = null;
  const startTime = Date.now();

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Retry sur certains codes HTTP
      if (RETRY_STATUS_CODES.has(response.status) && attempt < maxRetries) {
        const delay = retryDelay(attempt);
        console.warn(
          `Retry model=${model} attempt=${attempt + 1} status=${response.status} delay=${Math.round(delay)}ms`,
        );
        await sleep(delay);
        continue;
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        lastError = `HTTP ${response.status}: ${text.slice(0, 200)}`;
        console.error(`Model ${model} HTTP ${response.status} (no retry): ${text.slice(0, 200)}`);

        // Track des erreurs recentes pour permettre au server de diagnostiquer
        recordModelError(model, response.status, text);

        return null;
      }

      const data = await response.json();
      const message = data.choices?.[0]?.message;
      if (!message) {
        console.error(`Model ${model} : structure de reponse inattendue`);
        return null;
      }

      return {
        model: data.model || model,
        content: message.content,
        reasoning_details: message.reasoning_details,
        usage: extractUsage(data),
        duration_ms: Date.now() - startTime,
      };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = `${err.name}: ${err.message}`;
      const isRetryable = err.name === 'AbortError' || err.name === 'TypeError';   // TypeError = network errors
      if (isRetryable && attempt < maxRetries) {
        const delay = retryDelay(attempt);
        console.warn(`Retry model=${model} attempt=${attempt + 1} ${lastError} delay=${Math.round(delay)}ms`);
        await sleep(delay);
        continue;
      }
      console.error(`Model ${model} erreur: ${lastError}`);
      return null;
    }
  }

  console.error(`Model ${model} echec apres ${maxRetries + 1} tentatives: ${lastError}`);
  return null;
}

/**
 * Appelle plusieurs modeles en parallele.
 * @returns {Promise<Object<string, Object|null>>}  map {modelId: response}
 */
export async function queryModelsParallel(models, messages, options = {}) {
  const tasks = models.map((m) => queryModel(m, messages, options));
  const responses = await Promise.all(tasks);
  const result = {};
  models.forEach((m, i) => {
    result[m] = responses[i];
  });
  return result;
}

/**
 * Ping un modele OpenRouter avec un appel minimal pour tester sa disponibilite.
 * Consomme 1 requete de quota par modele (donc utiliser avec parcimonie).
 *
 * @param {string} model
 * @returns {Promise<{model, status, latency_ms, error?}>}
 *   status: 'up' | 'rate_limited' | 'unavailable' | 'auth_error' | 'unknown'
 */
export async function pingModel(model, apiKey = null) {
  const startTime = Date.now();
  const effectiveKey = apiKey || OPENROUTER_API_KEY;
  if (!effectiveKey) {
    return { model, status: 'auth_error', latency_ms: 0, error: 'Aucune cle OpenRouter disponible' };
  }

  // Payload minimal : 1 token max en sortie, pas de retry pour avoir le statut "live"
  const payload = {
    model,
    messages: [{ role: 'user', content: 'ping' }],
    max_tokens: 1,
    usage: { include: true },
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);   // 15s max pour un ping

    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: buildHeaders(effectiveKey),
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const latency = Date.now() - startTime;

    if (response.ok) {
      return { model, status: 'up', latency_ms: latency };
    }

    const errText = await response.text().catch(() => '');
    const errSnippet = errText.slice(0, 150);

    if (response.status === 401 || response.status === 403) {
      return { model, status: 'auth_error', latency_ms: latency, error: `HTTP ${response.status}` };
    }
    if (response.status === 429) {
      return { model, status: 'rate_limited', latency_ms: latency, error: 'Rate limited upstream' };
    }
    if (response.status === 404) {
      return { model, status: 'unavailable', latency_ms: latency, error: 'No endpoints found' };
    }
    return { model, status: 'unknown', latency_ms: latency, error: `HTTP ${response.status}: ${errSnippet}` };
  } catch (err) {
    return {
      model,
      status: err.name === 'AbortError' ? 'unavailable' : 'unknown',
      latency_ms: Date.now() - startTime,
      error: `${err.name}: ${err.message}`,
    };
  }
}

/**
 * Ping plusieurs modeles en parallele.
 */
export async function pingModelsParallel(models) {
  return Promise.all(models.map((m) => pingModel(m)));
}
