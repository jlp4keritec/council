// backend/quota.js v2.7.1
//
// Detection dynamique du quota journalier reel.
//
// LOGIQUE CORRIGEE v2.7.1 :
//   - AU MOINS un modele :free dans la config → on applique le quota free
//     (parce que ces :free vont consommer le quota free-per-day OpenRouter,
//     meme si le council contient aussi des modeles payants par ailleurs)
//   - ZERO modele :free (100% payant) → seul cas ou on ignore la quota
//
// Le bug v2.7.0 etait l'inverse : un seul modele payant suffisait a basculer
// en "MODE PAYANT" et a couper la verification du quota, alors que les :free
// du meme council continuaient a consommer la quota OpenRouter en sous-marin.
//
// Le ratio "1 question Council = ~10 requetes OpenRouter" vient du pipeline
// 3-stages : 4 Stage 1 + 4 Stage 2 + 1 Stage 3 + 1 titre = 10 appels.
// Avec un council mixte (ex 4 :free + 1 chairman payant) chaque question
// consomme environ 8 req :free (4 stage1 + 4 stage2), donc on hitte la
// limite de 50 req/jour en ~6 questions.

import { OPENROUTER_API_KEY, DAILY_QUOTA_QUESTIONS } from './config.js';

const REQUESTS_PER_QUESTION = 10;
const KEY_INFO_CACHE_TTL_MS = 60 * 60 * 1000;   // 1h

let keyInfoCache = null;
let keyInfoCacheExpires = 0;

/**
 * Interroge OpenRouter /api/v1/auth/key et renvoie l'objet `data`.
 * Cache 1h pour ne pas consommer le quota juste pour cette info.
 */
export async function getOpenRouterKeyInfo(forceRefresh = false) {
  const now = Date.now();
  if (!forceRefresh && keyInfoCache && now < keyInfoCacheExpires) {
    return keyInfoCache;
  }
  if (!OPENROUTER_API_KEY) return null;

  try {
    const res = await fetch('https://openrouter.ai/api/v1/auth/key', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) {
      console.warn(`[quota] /auth/key returned HTTP ${res.status}`);
      return null;
    }
    const json = await res.json();
    const info = json?.data || null;
    keyInfoCache = info;
    keyInfoCacheExpires = now + KEY_INFO_CACHE_TTL_MS;
    return info;
  } catch (err) {
    console.warn(`[quota] /auth/key fetch failed: ${err.message}`);
    return null;
  }
}

/** Force le refresh du cache au prochain appel. */
export function invalidateKeyInfoCache() {
  keyInfoCache = null;
  keyInfoCacheExpires = 0;
}

/** True si l'id de modele est un modele :free. */
export function isModelFree(modelId) {
  if (!modelId || typeof modelId !== 'string') return false;
  return modelId.endsWith(':free');
}

/**
 * True si AU MOINS UN modele du council est :free.
 * Inclut council_models + chairman_model + title_model.
 *
 * Si ce retour est true, on doit appliquer le quota free OpenRouter car les
 * modeles :free presents vont consommer le quota free-per-day, meme si le
 * council contient aussi des modeles payants.
 */
export function councilUsesFreeModels({ council_models = [], chairman_model, title_model }) {
  const all = [...council_models];
  if (chairman_model) all.push(chairman_model);
  if (title_model) all.push(title_model);
  if (all.length === 0) return true;   // pas de config = on suppose free
  return all.some(isModelFree);
}

/**
 * Calcule le quota effectif pour la config active.
 *
 * @param {Object} config  council_models, chairman_model, title_model
 * @returns {Promise<{
 *   mode: 'free_no_credit'|'free_with_credit'|'paid_or_mixed'|'unknown',
 *   questions_per_day: number|null,
 *   raw_requests_per_day: number|null,
 *   show_progress_bar: boolean,
 *   reason: string,
 *   openrouter_tier: string|null,
 *   credit_balance_usd: number|null,
 *   manual_override: boolean
 * }>}
 */
export async function computeEffectiveQuota(config) {
  // Override manuel via .env (legacy) : si l'utilisateur a mis une valeur
  // explicite differente du default 5, on respecte sa decision.
  const envOverride = DAILY_QUOTA_QUESTIONS && DAILY_QUOTA_QUESTIONS !== 5;

  // 1. ZERO :free dans la config → 100% payant, pas de quota free applicable
  //    (les modeles payants ne sont pas soumis a free-models-per-day OpenRouter)
  if (!councilUsesFreeModels(config)) {
    return {
      mode: 'paid_or_mixed',
      questions_per_day: envOverride ? DAILY_QUOTA_QUESTIONS : null,
      raw_requests_per_day: null,
      show_progress_bar: envOverride,
      reason: 'Tous les modeles du council sont payants — pas de quota free-per-day OpenRouter',
      openrouter_tier: null,
      credit_balance_usd: null,
      manual_override: envOverride,
    };
  }

  // 2. AU MOINS UN :free → on applique le quota free OpenRouter, meme si le
  //    council contient aussi des modeles payants. Les :free vont saturer en
  //    premier la limite free-per-day.
  const keyInfo = await getOpenRouterKeyInfo();

  if (!keyInfo) {
    return {
      mode: 'unknown',
      questions_per_day: envOverride ? DAILY_QUOTA_QUESTIONS : 5,
      raw_requests_per_day: envOverride ? null : 50,
      show_progress_bar: true,
      reason: 'Statut OpenRouter indisponible — fallback prudent free sans credit',
      openrouter_tier: 'unknown',
      credit_balance_usd: null,
      manual_override: envOverride,
    };
  }

  const isFreeTier = keyInfo.is_free_tier === true;
  const usage = typeof keyInfo.usage === 'number' ? keyInfo.usage : 0;
  const limit = typeof keyInfo.limit === 'number' ? keyInfo.limit : null;
  const balance = limit != null ? Math.max(0, limit - usage) : null;

  if (isFreeTier) {
    return {
      mode: 'free_no_credit',
      questions_per_day: envOverride ? DAILY_QUOTA_QUESTIONS : 5,
      raw_requests_per_day: 50,
      show_progress_bar: true,
      reason: '50 req/jour OpenRouter (free tier sans credit depose) ÷ 10 = ~5 questions/jour',
      openrouter_tier: 'free_no_credit',
      credit_balance_usd: balance,
      manual_override: envOverride,
    };
  }

  // is_free_tier = false → 10$+ deposes → 1000 req/jour pour les :free
  return {
    mode: 'free_with_credit',
    questions_per_day: envOverride ? DAILY_QUOTA_QUESTIONS : 100,
    raw_requests_per_day: 1000,
    show_progress_bar: true,
    reason: '1000 req/jour OpenRouter (credit depose sur le compte) ÷ 10 = ~100 questions/jour',
    openrouter_tier: 'free_with_credit',
    credit_balance_usd: balance,
    manual_override: envOverride,
  };
}

export { REQUESTS_PER_QUESTION };
