// Fastify backend pour le LLM Council.
//
// V2 :
// - GET /api/models?search=...&pricing=free|paid|all  proxy OpenRouter (cache 1h)
// - POST .../message[/stream] accepte un champ `override` pour customiser
//   council_models / chairman_model / eval_criteria a la volee
// - SSE envoie aussi les timings et duration_ms par modele

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

const fastify = Fastify({
  logger: { level: process.env.LOG_LEVEL || 'info' },
  bodyLimit: 1024 * 1024,
});

await fastify.register(cors, {
  origin: CORS_ORIGINS,
  credentials: true,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
});

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
      // is_free : si les 2 prix sont a 0 OU si l'id finit par :free
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
    // Si on a un cache obsolete, on le renvoie quand meme plutot que de rien renvoyer
    return modelsCache.data || [];
  }
}

// ---------------------------------------------------------------------------
// Health & config
// ---------------------------------------------------------------------------

fastify.get('/', async () => ({
  status: 'ok',
  service: 'LLM Council API',
  version: '2.1.0',
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
// Health check de modeles (cache 5 min pour ne pas gaspiller le quota)
// ---------------------------------------------------------------------------

const healthCache = new Map();   // model_id -> {result, fetchedAt}
const HEALTH_CACHE_TTL_MS = 5 * 60 * 1000;   // 5 minutes

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

  // Verifier le cache pour chaque modele
  for (const m of models) {
    const cached = healthCache.get(m);
    if (!force_refresh && cached && now - cached.fetchedAt < HEALTH_CACHE_TTL_MS) {
      fromCache.push({ ...cached.result, cached: true, cache_age_ms: now - cached.fetchedAt });
    } else {
      toPing.push(m);
    }
  }

  // Ping en parallele les modeles non en cache
  if (toPing.length > 0) {
    fastify.log.info(`Ping ${toPing.length} modele(s) (${fromCache.length} depuis cache)`);
    const results = await pingModelsParallel(toPing);
    for (const r of results) {
      healthCache.set(r.model, { result: r, fetchedAt: now });
      fromCache.push({ ...r, cached: false, cache_age_ms: 0 });
    }
  }

  // Renvoyer dans l'ordre demande
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
// Models endpoint (proxy OpenRouter avec recherche / filtre)
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

  // Tri : free d'abord (utile en POC), puis par nom
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
// Usage / Quota — compte les questions posees aujourd'hui
// ---------------------------------------------------------------------------

fastify.get('/api/usage', async () => {
  const conversations = await storage.listConversations();
  const today = new Date().toISOString().slice(0, 10);   // YYYY-MM-DD

  let questionsToday = 0;
  // On compte les messages assistant (= 1 question complete = 1 message) creees aujourd'hui
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

  const remaining = Math.max(0, DAILY_QUOTA_QUESTIONS - questionsToday);
  const percent_used = DAILY_QUOTA_QUESTIONS > 0
    ? Math.min(100, Math.round((questionsToday / DAILY_QUOTA_QUESTIONS) * 100))
    : 0;

  return {
    questions_today: questionsToday,
    quota_daily: DAILY_QUOTA_QUESTIONS,
    remaining,
    percent_used,
    estimated_requests: questionsToday * 10,   // ~10 appels OpenRouter par question
  };
});

// ---------------------------------------------------------------------------
// Conversations CRUD
// ---------------------------------------------------------------------------

fastify.get('/api/conversations', async () => await storage.listConversations());

fastify.post('/api/conversations', async () => {
  const id = randomUUID();
  return await storage.createConversation(id);
});

fastify.get('/api/conversations/:id', async (request, reply) => {
  const conv = await storage.getConversation(request.params.id);
  if (!conv) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }
  return conv;
});

fastify.delete('/api/conversations/:id', async (request, reply) => {
  const success = await storage.deleteConversation(request.params.id);
  if (!success) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }
  return { deleted: true, id: request.params.id };
});

// ---------------------------------------------------------------------------
// Export d'un message assistant en MD / JSON / DOCX / PPTX
// ---------------------------------------------------------------------------

fastify.get('/api/conversations/:id/export', async (request, reply) => {
  const { id } = request.params;
  const { format = 'md', message_index } = request.query;

  const conv = await storage.getConversation(id);
  if (!conv) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

  // Si pas de message_index, on prend le dernier message assistant
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

  // Nom de fichier base sur le titre de la conv (sanitize basique)
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
// Helper : extraire l'override de config depuis le body
// ---------------------------------------------------------------------------

function extractOverride(body) {
  const override = body?.override || {};
  // Validation simple : seuls les champs supportes sont retenus
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
  if (!conv) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

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
// Pipeline council (streaming SSE) — avec override + timings dans les events
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
  if (!conv) {
    reply.code(404);
    return { error: 'Conversation introuvable' };
  }

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
      // Analyse des erreurs recentes pour formuler un message clair
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
        recent_errors: recentErrors.slice(-10),   // 10 derniers pour debug
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

    // Titre
    if (titlePromise) {
      const title = await titlePromise;
      await storage.updateConversationTitle(id, title);
      sse({ type: 'title_complete', data: { title } });
    }

    // Pricing + timings global
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
// Start
// ---------------------------------------------------------------------------

try {
  await fastify.listen({ host: HOST, port: PORT });
  fastify.log.info(`LLM Council API listening on http://${HOST}:${PORT}`);
} catch (err) {
  fastify.log.error(err);
  process.exit(1);
}
