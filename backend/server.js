// Fastify backend pour le LLM Council.
//
// V2.8 :
// - Auth mono-user (admin + OPENROUTER_API_KEY) via cookie HMAC httpOnly
// - Routes /api/auth/login, /api/auth/logout, /api/auth/me
// - Toutes les autres /api/* sont protegees par preHandler
// - CORS configure pour credentials: true (cookies)
//
// V2.7 :
// - Quota dynamique : /api/usage detecte automatiquement le mode actif
// - Nouveau POST /api/usage/refresh
//
// V2 :
// - GET /api/models?search=...&pricing=free|paid|all
// - POST .../message[/stream] accepte un champ `override`
// - SSE envoie les timings et duration_ms par modele

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';

import {
  CORS_ORIGINS,
  HOST,
  PORT,
  CHAIRMAN_MODEL,
  COUNCIL_MODELS,
  TITLE_MODEL,
  EVAL_CRITERIA,
  OPENROUTER_API_KEY,
  DAILY_QUOTA_QUESTIONS,
  COUNCIL_MIN_RESPONSES,
  COUNCIL_FALLBACK_POOL,
  CHAIRMAN_ANALYSIS_ENABLED,
} from './config.js';
import * as storage from './storage.js';
import { searchConversations, getSearchFacets } from './search.js';
import { pushConversationToCortex } from './cortex.js';
import {
  runFullCouncil,
  generateConversationTitle,
  stage1CollectResponses,
  stage2CollectRankings,
  stage3SynthesizeFinal,
  calculateAggregateRankings,
} from './council.js';
import { aggregateUsage } from './pricing.js';
import { pingModelsParallel, getRecentModelErrors } from './openrouter.js';
import { exportToMarkdown, exportToJson, exportToDocx, exportToPptx } from './exporters.js';
import { computeEffectiveQuota, invalidateKeyInfoCache } from './quota.js';
import { registerAuthPlugin } from './auth.js';

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 1024 * 1024,
});

// CORS — credentials: true OBLIGATOIRE pour que le browser envoie/recoive les cookies
await fastify.register(cors, {
  origin: CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
});

// ---------------------------------------------------------------------------
// AUTH — enregistrer le plugin AVANT toute autre route /api/*
// Le preHandler global verifiera les cookies sur toutes les routes protegees.
// ---------------------------------------------------------------------------
registerAuthPlugin(fastify);

// ---------------------------------------------------------------------------
// Cache des modeles OpenRouter (TTL 1h)
// ---------------------------------------------------------------------------

let modelsCache = { data: null, fetchedAt: 0 };
const MODELS_CACHE_TTL_MS = 60 * 60 * 1000;   // 1h

async function fetchOpenRouterModels() {
  const now = Date.now();
  if (modelsCache.data && now - modelsCache.fetchedAt < MODELS_CACHE_TTL_MS) {
    return modelsCache.data;
  }

  fastify.log.info('Fetch de la liste des modeles OpenRouter');
  try {
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = await response.json();
    const models = (data.data || []).map((m) => ({
      id: m.id,
      name: m.name || m.id,
      context_length: m.context_length || 0,
      pricing: {
        prompt: parseFloat(m.pricing?.prompt || '0'),
        completion: parseFloat(m.pricing?.completion || '0'),
      },
      is_free:
        m.id.endsWith(':free') ||
        (parseFloat(m.pricing?.prompt || '0') === 0 &&
          parseFloat(m.pricing?.completion || '0') === 0),
    }));

    modelsCache = { data: models, fetchedAt: now };
    fastify.log.info(`${models.length} modeles charges (dont ${models.filter((m) => m.is_free).length} free)`);
    return models;
  } catch (err) {
    fastify.log.error({ err }, 'Erreur fetch /models, utilisation cache stale');
    return modelsCache.data || [];
  }
}

// ---------------------------------------------------------------------------
// Health & config
// ---------------------------------------------------------------------------

fastify.get('/', async () => ({
  status: 'ok',
  service: 'LLM Council API',
  version: '2.13.0',
}));

fastify.get('/health', async () => ({ status: 'ok' }));

fastify.get('/api/config', async () => ({
  council_models: COUNCIL_MODELS,
  chairman_model: CHAIRMAN_MODEL,
  chairman_is_external: !COUNCIL_MODELS.includes(CHAIRMAN_MODEL),
  title_model: TITLE_MODEL,
  eval_criteria: EVAL_CRITERIA,
  min_responses: COUNCIL_MIN_RESPONSES,
  fallback_pool: COUNCIL_FALLBACK_POOL,
  chairman_analysis: CHAIRMAN_ANALYSIS_ENABLED,
}));

// ---------------------------------------------------------------------------
// Health check de modeles (cache 5 min)
// ---------------------------------------------------------------------------

const healthCache = new Map();
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;

fastify.post('/api/models/health', async (request) => {
  const { models = [], force_refresh = false } = request.body || {};

  if (!Array.isArray(models) || models.length === 0) {
    return { error: "Body 'models' doit etre un array non vide" };
  }
  if (models.length > 20) {
    return { error: 'Maximum 20 modeles par check (eviter de gaspiller le quota)' };
  }

  const now = Date.now();
  const toPing = [];
  const fromCache = [];

  for (const m of models) {
    const cached = healthCache.get(m);
    if (!force_refresh && cached && now - cached.fetchedAt < HEALTH_CACHE_TTL_MS) {
      fromCache.push({ ...cached.result, cached: true, cache_age_ms: now - cached.fetchedAt });
    } else {
      toPing.push(m);
    }
  }

  if (toPing.length > 0) {
    fastify.log.info(`Ping ${toPing.length} modele(s) (${fromCache.length} depuis cache)`);
    const results = await pingModelsParallel(toPing);
    for (const r of results) {
      healthCache.set(r.model, { result: r, fetchedAt: now });
      fromCache.push({ ...r, cached: false, cache_age_ms: 0 });
    }
  }

  const ordered = models.map((m) => fromCache.find((r) => r.model === m));

  return {
    results: ordered,
    summary: {
      total: ordered.length,
      up: ordered.filter((r) => r.status === 'up').length,
      rate_limited: ordered.filter((r) => r.status === 'rate_limited').length,
      unavailable: ordered.filter((r) => r.status === 'unavailable').length,
      auth_error: ordered.filter((r) => r.status === 'auth_error').length,
      cache_ttl_ms: HEALTH_CACHE_TTL_MS,
    },
  };
});

// ---------------------------------------------------------------------------
// Models endpoint
// ---------------------------------------------------------------------------

fastify.get('/api/models', async (request) => {
  const { search = '', pricing = 'all', limit = '50' } = request.query;
  const models = await fetchOpenRouterModels();

  const searchLower = search.toLowerCase().trim();
  const limitNum = Math.min(parseInt(limit, 10) || 50, 200);

  let filtered = models;
  if (pricing === 'free') filtered = filtered.filter((m) => m.is_free);
  else if (pricing === 'paid') filtered = filtered.filter((m) => !m.is_free);

  if (searchLower) {
    filtered = filtered.filter(
      (m) => m.id.toLowerCase().includes(searchLower) || m.name.toLowerCase().includes(searchLower),
    );
  }

  filtered.sort((a, b) => {
    if (a.is_free !== b.is_free) return a.is_free ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return {
    total: filtered.length,
    models: filtered.slice(0, limitNum),
    cache_age_ms: Date.now() - modelsCache.fetchedAt,
  };
});

// ---------------------------------------------------------------------------
// Usage / Quota
// ---------------------------------------------------------------------------

fastify.get('/api/usage', async (request) => {
  const q = request.query || {};
  const activeConfig = {
    council_models: q.council_models
      ? q.council_models.split(',').map((m) => m.trim()).filter(Boolean)
      : COUNCIL_MODELS,
    chairman_model: q.chairman_model || CHAIRMAN_MODEL,
    title_model: q.title_model || TITLE_MODEL,
  };

  const conversations = await storage.listConversations(request.user);
  const today = new Date().toISOString().slice(0, 10);
  let questionsToday = 0;
  for (const conv of conversations) {
    const full = await storage.getConversation(conv.id);
    if (!full) continue;
    for (const msg of full.messages || []) {
      if (msg.role !== 'assistant') continue;
      if (msg.created_at && msg.created_at.startsWith(today)) {
        questionsToday += 1;
      }
    }
  }

  const quota = await computeEffectiveQuota(activeConfig);
  const limit = quota.questions_per_day;
  const remaining = limit != null ? Math.max(0, limit - questionsToday) : null;
  const percent_used = limit != null && limit > 0
    ? Math.min(100, Math.round((questionsToday / limit) * 100))
    : 0;

  return {
    questions_today: questionsToday,
    quota_daily: limit != null ? limit : DAILY_QUOTA_QUESTIONS,
    remaining: remaining != null ? remaining : 9999,
    percent_used,
    estimated_requests: questionsToday * 10,
    quota: {
      mode: quota.mode,
      limit,
      raw_requests_per_day: quota.raw_requests_per_day,
      show_progress_bar: quota.show_progress_bar,
      reason: quota.reason,
      openrouter_tier: quota.openrouter_tier,
      credit_balance_usd: quota.credit_balance_usd,
      manual_override: quota.manual_override,
    },
  };
});

fastify.post('/api/usage/refresh', async () => {
  invalidateKeyInfoCache();
  fastify.log.info('Cache OpenRouter /auth/key invalide manuellement');
  return { ok: true, message: 'Cache invalide, prochain GET /api/usage rafraichira' };
});

// ---------------------------------------------------------------------------
// Conversations CRUD
// ---------------------------------------------------------------------------

fastify.get('/api/conversations', async (request) => await storage.listConversations(request.user));

// Recherche filtree (mot-cle optionnel + periode + juge + president)
fastify.get('/api/search', async (request) => {
  const Q = request.query || {};
  const criteria = {
    q: (Q.q || '').trim(),
    date_from: Q.date_from || null,
    date_to: Q.date_to || null,
    judge: Q.judge || null,
    chairman: Q.chairman || null,
  };
  const results = await searchConversations(criteria, request.user);
  return { criteria, results };
});

// Liste des juges / presidents presents dans l'historique (pour les menus)
fastify.get('/api/search/facets', async (request) => {
  return await getSearchFacets(request.user);
});

fastify.post('/api/conversations', async (request) => {
  const id = randomUUID();
  return await storage.createConversation(id, request.user.id);
});

fastify.get('/api/conversations/:id', async (request, reply) => {
  const conv = await storage.getConversation(request.params.id);
  if (!conv || !storage.userCanAccess(conv, request.user)) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }
  return conv;
});

fastify.delete('/api/conversations/:id', async (request, reply) => {
  const existing = await storage.getConversation(request.params.id);
  if (!existing || !storage.userCanAccess(existing, request.user)) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }
  await storage.deleteConversation(request.params.id);
  return { deleted: true, id: request.params.id };
});

// ---------------------------------------------------------------------------
// Envoi vers Cortex (second cerveau)
// ---------------------------------------------------------------------------

fastify.post('/api/conversations/:id/to-cortex', async (request, reply) => {
  const { id } = request.params;
  const { message_index } = request.body || {};

  const conv = await storage.getConversation(id);
  if (!conv || !storage.userCanAccess(conv, request.user)) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

  // Resoudre l index du message assistant (meme logique que l export)
  let idx = parseInt(message_index, 10);
  if (isNaN(idx) || idx < 0 || idx >= conv.messages.length || conv.messages[idx].role !== 'assistant') {
    idx = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'assistant') { idx = i; break; }
    }
    if (idx === -1) {
      reply.code(404);
      return { error: 'Aucune réponse assistant à envoyer' };
    }
  }

  try {
    const note = await pushConversationToCortex(conv, idx);
    fastify.log.info(`Note envoyée à Cortex : "${note.title}"`);
    return { ok: true, title: note.title, tags: note.tags };
  } catch (err) {
    fastify.log.error({ err }, 'Echec envoi Cortex');
    reply.code(502);
    return { error: err.message || 'Erreur lors de l envoi vers Cortex' };
  }
});

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

fastify.get('/api/conversations/:id/export', async (request, reply) => {
  const { id } = request.params;
  const { format = 'md', message_index } = request.query;

  const conv = await storage.getConversation(id);
  if (!conv || !storage.userCanAccess(conv, request.user)) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

  let assistantIndex = parseInt(message_index, 10);
  if (isNaN(assistantIndex) || assistantIndex < 0 || assistantIndex >= conv.messages.length) {
    assistantIndex = -1;
    for (let i = conv.messages.length - 1; i >= 0; i--) {
      if (conv.messages[i].role === 'assistant') { assistantIndex = i; break; }
    }
    if (assistantIndex === -1) {
      reply.code(404);
      return { error: 'Aucun message assistant dans la conversation' };
    }
  }

  if (conv.messages[assistantIndex].role !== 'assistant') {
    reply.code(400);
    return { error: 'Le message demande n\'est pas une reponse assistant' };
  }

  const safeTitle = (conv.title || 'council')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 50);
  const dateStr = new Date().toISOString().slice(0, 10);
  const baseName = `council-${safeTitle}-${dateStr}`;

  try {
    if (format === 'json') {
      const content = exportToJson(conv, assistantIndex);
      reply.header('Content-Type', 'application/json; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.json"`);
      return content;
    }
    if (format === 'md' || format === 'markdown') {
      const content = exportToMarkdown(conv, assistantIndex);
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.md"`);
      return content;
    }
    if (format === 'docx') {
      const buffer = await exportToDocx(conv, assistantIndex);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.docx"`);
      return reply.send(buffer);
    }
    if (format === 'pptx') {
      const buffer = await exportToPptx(conv, assistantIndex);
      reply.header('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      reply.header('Content-Disposition', `attachment; filename="${baseName}.pptx"`);
      return reply.send(buffer);
    }

    reply.code(400);
    return { error: `Format inconnu : ${format}. Valides : md, json, docx, pptx` };
  } catch (err) {
    fastify.log.error({ err }, `Echec export ${format}`);
    reply.code(500);
    return { error: `Erreur generation ${format}: ${err.message}` };
  }
});

// ---------------------------------------------------------------------------
// Helper override
// ---------------------------------------------------------------------------

import * as users from './users.js';

/**
 * Resout la cle OpenRouter a utiliser pour cette requete.
 * Politique (v2.15, strict) :
 *  - Utilisateur normal : DOIT avoir sa propre cle dans Mon compte.
 *  - Administrateur : peut utiliser la cle du .env (filet de securite).
 * Renvoie { key, source: 'user'|'env' } ou { error, code, message } si refus.
 */
async function resolveApiKey(reqUser) {
  const userKey = await users.getDecryptedKey(reqUser.id);
  if (userKey) return { key: userKey, source: 'user' };
  if (reqUser.is_admin && process.env.OPENROUTER_API_KEY) {
    return { key: process.env.OPENROUTER_API_KEY, source: 'env' };
  }
  return {
    error: true,
    code: 'no_api_key',
    message: 'Pour utiliser le Council, ajoute ta clé OpenRouter dans « Mon compte ».',
  };
}

function extractOverride(body) {
  const override = body?.override || {};
  const result = {};
  if (Array.isArray(override.council_models) && override.council_models.length >= 2) {
    result.council_models = override.council_models.filter((m) => typeof m === 'string' && m.trim());
  }
  if (typeof override.chairman_model === 'string' && override.chairman_model.trim()) {
    result.chairman_model = override.chairman_model.trim();
  }
  if (typeof override.title_model === 'string' && override.title_model.trim()) {
    result.title_model = override.title_model.trim();
  }
  if (typeof override.eval_criteria === 'string' && override.eval_criteria.trim()) {
    result.eval_criteria = override.eval_criteria.trim();
  }
  if (Array.isArray(override.fallback_pool)) {
    result.fallback_pool = override.fallback_pool.filter((m) => typeof m === 'string' && m.trim());
  }
  if (Number.isInteger(override.min_responses) && override.min_responses >= 1) {
    result.min_responses = override.min_responses;
  }
  if (typeof override.chairman_analysis === 'boolean') {
    result.chairman_analysis = override.chairman_analysis;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Pipeline council (blocking)
// ---------------------------------------------------------------------------

fastify.post('/api/conversations/:id/message', async (request, reply) => {
  const { id } = request.params;
  const { content } = request.body || {};
  const override = extractOverride(request.body);

  if (!content || typeof content !== 'string') {
    reply.code(400);
    return { error: "Champ 'content' manquant" };
  }

  const conv = await storage.getConversation(id);
  if (!conv || !storage.userCanAccess(conv, request.user)) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

  // Resoudre la cle OpenRouter de l'utilisateur (strict v2.15)
  const keyResult = await resolveApiKey(request.user);
  if (keyResult.error) {
    reply.code(403);
    return { error: keyResult.code, message: keyResult.message };
  }
  override.apiKey = keyResult.key;

  const isFirstMessage = conv.messages.length === 0;
  await storage.addUserMessage(id, content);

  if (isFirstMessage) {
    const title = await generateConversationTitle(content, override);
    await storage.updateConversationTitle(id, title);
  }

  const result = await runFullCouncil(content, override);

  await storage.addAssistantMessage(id, {
    stage1: result.stage1,
    stage2: result.stage2,
    stage3: result.stage3,
    metadata: result.metadata,
    pricing: result.pricing,
    timings: result.timings,
  });

  return result;
});

// ---------------------------------------------------------------------------
// Pipeline council (streaming SSE)
// ---------------------------------------------------------------------------

fastify.post('/api/conversations/:id/message/stream', async (request, reply) => {
  const { id } = request.params;
  const { content } = request.body || {};
  const override = extractOverride(request.body);

  if (!content || typeof content !== 'string') {
    reply.code(400);
    return { error: "Champ 'content' manquant" };
  }

  const conv = await storage.getConversation(id);
  if (!conv || !storage.userCanAccess(conv, request.user)) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

  // Resoudre la cle OpenRouter (strict v2.15) AVANT d'ouvrir le flux SSE
  const keyResult = await resolveApiKey(request.user);
  if (keyResult.error) {
    reply.code(403);
    return { error: keyResult.code, message: keyResult.message };
  }
  override.apiKey = keyResult.key;

  const isFirstMessage = conv.messages.length === 0;

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const sse = (payload) => reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);

  try {
    const pipelineStart = Date.now();

    await storage.addUserMessage(id, content);

    const titlePromise = isFirstMessage ? generateConversationTitle(content, override) : null;

    // Stage 1
    sse({ type: 'stage1_start' });
    const stage1 = await stage1CollectResponses(content, override);
    sse({
      type: 'stage1_complete',
      data: stage1.results,
      pricing: aggregateUsage(stage1.usages),
      duration_ms: stage1.stage_duration_ms,
      failed_models: stage1.failed_models,
      attempted_fallback: stage1.attempted_fallback,
      reached_minimum: stage1.reached_minimum,
      min_responses_target: stage1.min_responses_target,
    });

    if (stage1.results.length === 0) {
      const recentErrors = getRecentModelErrors(pipelineStart);
      const quotaErrors = recentErrors.filter((e) => e.code === 'quota_free_daily');
      const noEndpointsErrors = recentErrors.filter((e) => e.code === 'no_endpoints');
      const rateLimitErrors = recentErrors.filter((e) => e.code === 'rate_limit');
      const authErrors = recentErrors.filter((e) => e.code === 'auth');

      let errorCode = 'all_failed';
      let errorMessage;

      if (quotaErrors.length > 0) {
        errorCode = 'quota_free_daily';
        errorMessage = `Quota OpenRouter free atteint pour aujourd'hui (50 req/jour sans crédit). Solutions :\n\n` +
          `• Déposer 10$ sur https://openrouter.ai/credits (passe à 1000 req/jour, le crédit n'est pas consommé tant que tu utilises les :free)\n` +
          `• Attendre minuit UTC pour le reset du quota\n` +
          `• Ajouter des modèles payants au Council (ils ne sont pas soumis au quota free)`;
      } else if (authErrors.length > 0) {
        errorCode = 'auth';
        errorMessage = `Erreur d'authentification OpenRouter. Vérifie ta clé API dans le .env (OPENROUTER_API_KEY).`;
      } else if (noEndpointsErrors.length === recentErrors.length && recentErrors.length > 0) {
        errorCode = 'no_endpoints_all';
        errorMessage = `Tous les modèles :free retournent "No endpoints found". Les providers gratuits sont temporairement indisponibles. Réessaie dans quelques minutes ou utilise le bouton "Test disponibilité" dans la modal Configuration.`;
      } else if (rateLimitErrors.length > 0) {
        errorCode = 'rate_limit_upstream';
        errorMessage = `Tous les modèles sont rate-limited upstream (saturation provider). Réessaie dans quelques minutes.`;
      } else {
        errorMessage = `Tous les modèles ont échoué au Stage 1. Détail : ${recentErrors.map((e) => `${e.model.split('/').pop()} HTTP ${e.status}`).join(' / ') || 'aucune info'}`;
      }

      sse({
        type: 'error',
        message: errorMessage,
        error_code: errorCode,
        recent_errors: recentErrors.slice(-10),
      });
      reply.raw.end();
      return;
    }

    // Stage 2
    sse({ type: 'stage2_start' });
    const stage2 = await stage2CollectRankings(content, stage1.results, override);
    const aggregateRankings = calculateAggregateRankings(stage2.rankings, stage2.labelToModel);
    sse({
      type: 'stage2_complete',
      data: stage2.rankings,
      metadata: {
        label_to_model: stage2.labelToModel,
        aggregate_rankings: aggregateRankings,
      },
      pricing: aggregateUsage(stage2.usages),
      duration_ms: stage2.stage_duration_ms,
    });

    // Stage 3
    sse({ type: 'stage3_start' });
    const stage3 = await stage3SynthesizeFinal(
      content,
      stage1.results,
      stage2.rankings,
      aggregateRankings,
      override,
    );
    sse({
      type: 'stage3_complete',
      data: stage3.result,
      pricing: aggregateUsage(stage3.usage ? [stage3.usage] : []),
      duration_ms: stage3.result.duration_ms || 0,
    });

    if (titlePromise) {
      const title = await titlePromise;
      await storage.updateConversationTitle(id, title);
      sse({ type: 'title_complete', data: { title } });
    }

    const allUsages = [...stage1.usages, ...stage2.usages];
    if (stage3.usage) allUsages.push(stage3.usage);
    const pricing = {
      stage1: aggregateUsage(stage1.usages),
      stage2: aggregateUsage(stage2.usages),
      stage3: aggregateUsage(stage3.usage ? [stage3.usage] : []),
      total: aggregateUsage(allUsages),
    };
    const timings = {
      stage1_ms: stage1.stage_duration_ms,
      stage2_ms: stage2.stage_duration_ms,
      stage3_ms: stage3.result.duration_ms || 0,
      total_ms: stage1.stage_duration_ms + stage2.stage_duration_ms + (stage3.result.duration_ms || 0),
    };

    await storage.addAssistantMessage(id, {
      stage1: stage1.results,
      stage2: stage2.rankings,
      stage3: stage3.result,
      metadata: {
        label_to_model: stage2.labelToModel,
        aggregate_rankings: aggregateRankings,
        failed_models_stage1: stage1.failed_models,
        attempted_fallback: stage1.attempted_fallback,
        reached_minimum: stage1.reached_minimum,
        min_responses_target: stage1.min_responses_target,
      },
      pricing,
      timings,
    });

    sse({ type: 'complete', pricing, timings });
  } catch (err) {
    fastify.log.error(err, 'Erreur dans le pipeline SSE');
    sse({ type: 'error', message: err.message || 'Erreur interne' });
  } finally {
    reply.raw.end();
  }
});

// ---------------------------------------------------------------------------
// Panneau Administrateur (v2.16)
// ---------------------------------------------------------------------------
// Toutes les routes /api/admin/* exigent un compte AVEC `is_admin === true`.
// Sinon -> 403.

function requireAdmin(request, reply) {
  if (!request.user || !request.user.is_admin) {
    reply.code(403);
    reply.send({ error: 'forbidden', message: 'Accès réservé aux administrateurs.' });
    return false;
  }
  return true;
}

// Calcule les stats par utilisateur a partir des conversations stockees.
// Renvoie une map userId -> { conv_count, total_cost_usd, last_active_at }.
async function computeUserStats() {
  // Pas de filtre user -> on voit TOUTES les conversations (admin only context)
  const all = await storage.listConversations();
  const byUser = new Map();
  for (const item of all) {
    if (!item.owner) continue; // conversations legacy : ignorees pour stats par user
    const conv = await storage.getConversation(item.id);
    if (!conv) continue;
    const stats = byUser.get(conv.owner) || { conv_count: 0, total_cost_usd: 0, last_active_at: null };
    stats.conv_count += 1;
    let convLast = conv.created_at;
    for (const msg of conv.messages || []) {
      if (msg.created_at && (!convLast || msg.created_at > convLast)) convLast = msg.created_at;
      if (msg.role === 'assistant') {
        const cost = msg.pricing?.total?.total_cost_usd;
        if (typeof cost === 'number' && Number.isFinite(cost)) stats.total_cost_usd += cost;
      }
    }
    if (!stats.last_active_at || (convLast && convLast > stats.last_active_at)) {
      stats.last_active_at = convLast;
    }
    byUser.set(conv.owner, stats);
  }
  return byUser;
}

// GET /api/admin/users  -> liste enrichie + stats
fastify.get('/api/admin/users', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;

  const all = await users.listAllUsers();
  const stats = await computeUserStats();

  const usersWithStats = all.map((u) => {
    const s = stats.get(u.id) || { conv_count: 0, total_cost_usd: 0, last_active_at: null };
    return {
      ...u,
      conv_count: s.conv_count,
      total_cost_usd: Math.round(s.total_cost_usd * 10000) / 10000, // 4 décimales
      last_active_at: s.last_active_at,
      // marquage utile cote client pour le "tu ne peux pas te toucher toi-meme"
      is_self: u.id === request.user.id,
    };
  });

  // Stats globales
  const totals = {
    users_count: all.length,
    active_users: all.filter((u) => !u.is_disabled).length,
    users_with_key: all.filter((u) => u.has_key).length,
    admins_count: all.filter((u) => u.is_admin).length,
    total_conversations: usersWithStats.reduce((s, u) => s + u.conv_count, 0),
    total_cost_usd: Math.round(usersWithStats.reduce((s, u) => s + u.total_cost_usd, 0) * 10000) / 10000,
  };

  return { totals, users: usersWithStats };
});

// PATCH /api/admin/users/:id  body: { is_active?, is_admin? }
fastify.patch('/api/admin/users/:id', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const targetId = request.params.id;
  if (targetId === request.user.id) {
    reply.code(400);
    return { error: 'self_target', message: 'Tu ne peux pas modifier ton propre statut.' };
  }
  const body = request.body || {};
  try {
    let updated = null;
    if (typeof body.is_active === 'boolean') {
      updated = await users.setActive(targetId, body.is_active);
      fastify.log.info(`[admin ${request.user.email}] ${body.is_active ? 'réactivé' : 'désactivé'} : ${updated.email}`);
    }
    if (typeof body.is_admin === 'boolean') {
      updated = await users.setAdmin(targetId, body.is_admin);
      fastify.log.info(`[admin ${request.user.email}] ${body.is_admin ? 'promu admin' : 'rétrogradé'} : ${updated.email}`);
    }
    if (!updated) {
      reply.code(400);
      return { error: 'no_change', message: 'Aucun changement (is_active ou is_admin requis).' };
    }
    return { ok: true, user: updated };
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      reply.code(404);
      return { error: 'not_found', message: 'Utilisateur introuvable.' };
    }
    throw err;
  }
});

// POST /api/admin/users/:id/reset-password  -> renvoie le mot de passe temporaire
fastify.post('/api/admin/users/:id/reset-password', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const targetId = request.params.id;
  if (targetId === request.user.id) {
    reply.code(400);
    return { error: 'self_target', message: 'Utilise « Mon compte » pour ton propre mot de passe.' };
  }
  try {
    const { temp_password } = await users.adminResetPassword(targetId);
    const u = await users.findById(targetId);
    fastify.log.info(`[admin ${request.user.email}] reset mot de passe : ${u?.email || targetId}`);
    return { ok: true, temp_password, email: u?.email || null };
  } catch (err) {
    if (err.code === 'NOT_FOUND') {
      reply.code(404);
      return { error: 'not_found', message: 'Utilisateur introuvable.' };
    }
    throw err;
  }
});

// DELETE /api/admin/users/:id  -> supprime compte + ses conversations
fastify.delete('/api/admin/users/:id', async (request, reply) => {
  if (!requireAdmin(request, reply)) return;
  const targetId = request.params.id;
  if (targetId === request.user.id) {
    reply.code(400);
    return { error: 'self_target', message: 'Utilise « Mon compte » pour te supprimer toi-même.' };
  }

  // 1) Conversations de l'utilisateur cible
  const targetUser = await users.findById(targetId);
  if (!targetUser) {
    reply.code(404);
    return { error: 'not_found', message: 'Utilisateur introuvable.' };
  }
  // listConversations sans user -> on voit TOUTES les conversations,
  // puis on filtre nous-memes sur owner === targetId.
  const list = await storage.listConversations();
  let removed = 0;
  for (const item of list) {
    if (item.owner === targetId) {
      if (await storage.deleteConversation(item.id)) removed += 1;
    }
  }
  // 2) Suppression du compte (sans password : route admin)
  const db = await users.listAllUsers(); // pour pouvoir invalider le cache si besoin
  // On a deja la fonction users.deleteUser mais elle exige le mot de passe. On
  // ajoute un mode admin : effacement direct via users.adminDelete ci-dessous.
  await users.adminDelete(targetId);
  fastify.log.info(`[admin ${request.user.email}] compte supprimé + ${removed} conversations : ${targetUser.email}`);
  return { ok: true, deleted_conversations: removed, email: targetUser.email };
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

try {
  await fastify.listen({ host: HOST, port: PORT });
  fastify.log.info(`LLM Council API v2.8 listening on http://${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
