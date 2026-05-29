// Orchestration 3-stages du LLM Council.
//
// V2 : ajout du timing par modele et par stage + override de la config par appel
// (council_models, chairman_model, eval_criteria peuvent etre fournis par le client
// pour overrider les defaults .env sans relancer le backend).

import {
  COUNCIL_MODELS as DEFAULT_COUNCIL_MODELS,
  CHAIRMAN_MODEL as DEFAULT_CHAIRMAN_MODEL,
  TITLE_MODEL as DEFAULT_TITLE_MODEL,
  EVAL_CRITERIA as DEFAULT_EVAL_CRITERIA,
  COUNCIL_MIN_RESPONSES as DEFAULT_MIN_RESPONSES,
  COUNCIL_FALLBACK_POOL as DEFAULT_FALLBACK_POOL,
  CHAIRMAN_ANALYSIS_ENABLED as DEFAULT_ANALYSIS_ENABLED,
  TITLE_TIMEOUT,
  THEME_VOCAB,
  THEME_TAGGING_ENABLED,
} from './config.js';
import { queryModel, queryModelsParallel } from './openrouter.js';
import {
  stage2RankingPrompt,
  stage3ChairmanPrompt,
  stage3ChairmanSimplePrompt,
  titlePrompt,
  titleAndThemePrompt,
  groundingSystemPrompt,
} from './prompts.js';
import { aggregateUsage } from './pricing.js';
import { fetchGrounding } from './retrieval.js';

// ============================================================================
// Anonymisation renforcee
// ============================================================================

const SIGNATURE_PATTERNS = [
  /^\s*(as |i am |i'?m |hi[,!]? i'?m |hello[,!]? i'?m |je suis |en tant que |salut[,!]? je suis )(claude|gemini|gpt[\- ]?\d?\.?\d?|chatgpt|grok|bard|llama|deepseek|mistral|qwen)[^.!?\n]*[.!?\n]/im,
  /^\s*(this is |voici )(claude|gemini|gpt|chatgpt|grok|bard|llama|deepseek|mistral|qwen)[^.!?\n]*[.!?\n]/im,
  /^\s*(claude|gemini|gpt|chatgpt|grok|bard|llama|deepseek|mistral|qwen)\s+(here|speaking|ici)[^.!?\n]*[.!?\n]/im,
  /^\s*(as an? |i am an? |je suis un[e]? |en tant qu')(anthropic|openai|google|x[\- ]?ai|xai|meta)[^.!?\n]*[.!?\n]/im,
];

export function stripSignatures(text) {
  if (!text) return text;
  let stripped = text;
  for (const pattern of SIGNATURE_PATTERNS) {
    stripped = stripped.replace(pattern, '');
  }
  return stripped.trimStart();
}

// ============================================================================
// Helper : extraire la config finale (overrides + defaults)
// ============================================================================

function resolveConfig(override = {}) {
  const councilModels = Array.isArray(override.council_models) && override.council_models.length >= 2
    ? override.council_models
    : DEFAULT_COUNCIL_MODELS;

  const chairmanModel = (override.chairman_model && override.chairman_model.trim())
    ? override.chairman_model.trim()
    : DEFAULT_CHAIRMAN_MODEL;

  const titleModel = (override.title_model && override.title_model.trim())
    ? override.title_model.trim()
    : DEFAULT_TITLE_MODEL;

  const evalCriteria = (override.eval_criteria && override.eval_criteria.trim())
    ? override.eval_criteria.trim()
    : DEFAULT_EVAL_CRITERIA;

  // Fallback pool : peut etre vide pour desactiver le mecanisme
  const fallbackPool = Array.isArray(override.fallback_pool)
    ? override.fallback_pool.filter((m) => typeof m === 'string' && m.trim())
    : DEFAULT_FALLBACK_POOL;

  const minResponses = Number.isInteger(override.min_responses) && override.min_responses >= 1
    ? override.min_responses
    : DEFAULT_MIN_RESPONSES;

  // chairman_analysis : peut etre explicitement false pour desactiver la meta-analyse
  const analysisEnabled = typeof override.chairman_analysis === 'boolean'
    ? override.chairman_analysis
    : DEFAULT_ANALYSIS_ENABLED;

  return { councilModels, chairmanModel, titleModel, evalCriteria, fallbackPool, minResponses, analysisEnabled };
}

// ============================================================================
// Stage 1 : collecte parallele (+ duration_ms par modele + fallback automatique)
// ============================================================================

export async function stage1CollectResponses(userQuery, override = {}) {
  const { councilModels, fallbackPool, minResponses } = resolveConfig(override);
  const stageStart = Date.now();

  // --- Grounding juridique (v2.10, fail-open) ---
  // On tente de recuperer des sources via MCP ; en cas d'echec, grounding = null
  // et on poursuit normalement. Si on a des sources, on les injecte en message
  // systeme en tete, vu par TOUS les membres du conseil.
  let grounding = null;
  const messages = [];
  try {
    grounding = await fetchGrounding(userQuery);
  } catch {
    grounding = null;   // ceinture + bretelles (fetchGrounding ne throw deja pas)
  }
  if (grounding && grounding.text) {
    messages.push({ role: 'system', content: groundingSystemPrompt(grounding.text) });
  }
  messages.push({ role: 'user', content: userQuery });

  // 1. Essai initial du council configure (en parallele)
  const responses = await queryModelsParallel(councilModels, messages, { apiKey: override.apiKey });

  const results = [];
  const usages = [];
  const failedModels = [];

  for (const model of councilModels) {
    const resp = responses[model];
    if (!resp || !resp.content) {
      console.warn(`Stage 1 : modele ${model} sans reponse`);
      failedModels.push(model);
      continue;
    }
    results.push({
      model,
      response: stripSignatures(resp.content),
      duration_ms: resp.duration_ms || null,
      from_fallback: false,
    });
    usages.push(resp.usage || null);
  }

  // 2. Si moins de minResponses, on pioche dans le pool de fallback (en serie)
  const attemptedFallback = [];

  if (results.length < minResponses && fallbackPool.length > 0) {
    const alreadyTried = new Set(councilModels);

    for (const fallbackModel of fallbackPool) {
      if (results.length >= minResponses) break;
      // openrouter/free peut etre appele plusieurs fois (router aleatoire)
      if (alreadyTried.has(fallbackModel) && fallbackModel !== 'openrouter/free') continue;

      attemptedFallback.push(fallbackModel);
      console.warn(`Stage 1 fallback : essai ${fallbackModel} (${results.length}/${minResponses} reponses actuelles)`);

      const resp = await queryModel(fallbackModel, messages, { apiKey: override.apiKey });

      if (resp && resp.content) {
        // model effectif renvoye par OpenRouter (utile pour openrouter/free)
        const effectiveModel = resp.model || fallbackModel;
        results.push({
          model: effectiveModel,
          response: stripSignatures(resp.content),
          duration_ms: resp.duration_ms || null,
          from_fallback: true,
          fallback_requested: fallbackModel,
        });
        usages.push(resp.usage || null);
      } else {
        console.warn(`Stage 1 fallback : ${fallbackModel} a aussi echoue`);
      }

      alreadyTried.add(fallbackModel);
    }
  }

  return {
    results,
    usages,
    failed_models: failedModels,
    attempted_fallback: attemptedFallback,
    reached_minimum: results.length >= minResponses,
    min_responses_target: minResponses,
    stage_duration_ms: Date.now() - stageStart,
    grounding: grounding ? { used: true, tool: grounding.tool, url: grounding.url, chars: grounding.text.length } : { used: false },
  };
}

// ============================================================================
// Stage 2 : peer ranking avec structured output (+ duration_ms par modele)
// ============================================================================

export async function stage2CollectRankings(userQuery, stage1Results, override = {}) {
  if (stage1Results.length === 0) {
    return { rankings: [], labelToModel: {}, usages: [], stage_duration_ms: 0 };
  }

  const { evalCriteria } = resolveConfig(override);
  const stageStart = Date.now();

  // Important : utilise les modeles qui ont REPONDU au Stage 1, pas la liste complete.
  // Evite d'envoyer une evaluation a un modele qui a foire en amont.
  const respondingModels = stage1Results.map((r) => r.model);

  const labels = stage1Results.map((_, i) => String.fromCharCode(65 + i));
  const labelToModel = {};
  stage1Results.forEach((r, i) => {
    labelToModel[`Response ${labels[i]}`] = r.model;
  });

  const responsesText = stage1Results
    .map((r, i) => `Response ${labels[i]}:\n${r.response}`)
    .join('\n\n');

  const prompt = stage2RankingPrompt(userQuery, responsesText, evalCriteria);
  const messages = [{ role: 'user', content: prompt }];
  const responseFormat = { type: 'json_object' };

  const responses = await queryModelsParallel(respondingModels, messages, { responseFormat, apiKey: override.apiKey });

  const rankings = [];
  const usages = [];
  const validLabels = new Set(Object.keys(labelToModel));

  for (const model of respondingModels) {
    const resp = responses[model];
    if (!resp || !resp.content) {
      console.warn(`Stage 2 : modele ${model} sans reponse`);
      continue;
    }

    const raw = resp.content;
    const parsed = parseStage2Response(raw, validLabels);

    rankings.push({
      model,
      raw_response: raw,
      parsed_evaluations: parsed.evaluations,
      parsed_ranking: parsed.ranking,
      parse_method: parsed.method,
      duration_ms: resp.duration_ms || null,
    });
    usages.push(resp.usage || null);
  }

  return {
    rankings,
    labelToModel,
    usages,
    stage_duration_ms: Date.now() - stageStart,
  };
}

function parseStage2Response(text, validLabels) {
  let parsed = tryParseJson(text);
  if (parsed && validateParsed(parsed, validLabels)) {
    return {
      evaluations: parsed.evaluations || [],
      ranking: (parsed.ranking || []).filter((r) => validLabels.has(r)),
      method: 'json',
    };
  }

  const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  if (fenceMatch) {
    parsed = tryParseJson(fenceMatch[1]);
    if (parsed && validateParsed(parsed, validLabels)) {
      return {
        evaluations: parsed.evaluations || [],
        ranking: (parsed.ranking || []).filter((r) => validLabels.has(r)),
        method: 'json',
      };
    }
  }

  return regexFallbackParse(text, validLabels);
}

function tryParseJson(s) {
  if (!s) return null;
  let str = s.trim();
  try {
    if (!str.startsWith('{')) {
      const match = str.match(/\{[\s\S]*\}/);
      if (!match) return null;
      str = match[0];
    }
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function validateParsed(parsed, validLabels) {
  if (!parsed || typeof parsed !== 'object') return false;
  const ranking = parsed.ranking;
  if (!Array.isArray(ranking) || ranking.length === 0) return false;
  const validCount = ranking.filter((r) => validLabels.has(r)).length;
  return validCount >= 1;
}

function regexFallbackParse(text, validLabels) {
  let ranking = [];

  const finalMatch = text.match(/final\s*ranking\s*[:\-]/i);
  const section = finalMatch ? text.slice(finalMatch.index + finalMatch[0].length) : text;

  const numbered = [...section.matchAll(/\d+\.\s*(Response [A-Z])/g)].map((m) => m[1]);
  if (numbered.length > 0) {
    ranking = numbered.filter((r) => validLabels.has(r));
  } else {
    const bare = [...section.matchAll(/Response [A-Z]/g)].map((m) => m[0]);
    ranking = bare.filter((r) => validLabels.has(r));
  }

  const seen = new Set();
  const deduped = [];
  for (const r of ranking) {
    if (!seen.has(r)) {
      seen.add(r);
      deduped.push(r);
    }
  }

  return {
    evaluations: [],
    ranking: deduped,
    method: 'regex_fallback',
  };
}

// ============================================================================
// Borda count
// ============================================================================

export function calculateAggregateRankings(stage2Results, labelToModel) {
  const positions = {};

  for (const ranking of stage2Results) {
    const parsed = ranking.parsed_ranking || [];
    parsed.forEach((label, idx) => {
      const modelName = labelToModel[label];
      if (modelName) {
        if (!positions[modelName]) positions[modelName] = [];
        positions[modelName].push(idx + 1);
      }
    });
  }

  const aggregate = [];
  for (const [model, posList] of Object.entries(positions)) {
    if (posList.length === 0) continue;
    const avg = posList.reduce((a, b) => a + b, 0) / posList.length;
    aggregate.push({
      model,
      average_rank: Number(avg.toFixed(2)),
      rankings_count: posList.length,
      raw_positions: posList,
    });
  }

  aggregate.sort((a, b) => a.average_rank - b.average_rank);
  return aggregate;
}

// ============================================================================
// Stage 3 : synthese du chairman (+ cascade fallback sur TOUS les council members)
// ============================================================================

export async function stage3SynthesizeFinal(userQuery, stage1Results, stage2Results, aggregateRankings, override = {}) {
  const { councilModels, chairmanModel, analysisEnabled } = resolveConfig(override);
  const stageStart = Date.now();

  const stage1Text = stage1Results
    .map((r) => `Modele : ${r.model}\nReponse : ${r.response}`)
    .join('\n\n');

  const stage2Text = stage2Results
    .map(
      (r) =>
        `Modele evaluateur : ${r.model}\nClassement produit : ${JSON.stringify(r.parsed_ranking)}\n` +
        `Methode de parsing : ${r.parse_method || 'unknown'}`,
    )
    .join('\n\n');

  const aggregateText = aggregateRankings
    .map(
      (a) =>
        `  - ${a.model} : rang moyen ${a.average_rank.toFixed(2)} ` +
        `(positions : [${a.raw_positions.join(', ')}])`,
    )
    .join('\n');

  // Choix du prompt selon que l'analyse meta-cognitive est activee ou non
  const prompt = analysisEnabled
    ? stage3ChairmanPrompt(userQuery, stage1Text, stage2Text, aggregateText)
    : stage3ChairmanSimplePrompt(userQuery, stage1Text, stage2Text, aggregateText);

  const messages = [{ role: 'user', content: prompt }];

  // JSON object uniquement si analyse activee (sinon markdown classique)
  const queryOptions = analysisEnabled
    ? { responseFormat: { type: 'json_object' }, apiKey: override.apiKey }
    : { apiKey: override.apiKey };

  // 1ere tentative : chairman officiel
  let response = await queryModel(chairmanModel, messages, queryOptions);
  let usedFallback = false;
  let usedModel = chairmanModel;
  const fallbacksTried = [];

  // CASCADE : si le chairman echoue, on essaie TOUS les modeles du council
  // (au lieu de juste le 1er) jusqu'a ce qu'un reponde.
  // Priorite donnee a ceux qui ont DEJA repondu en Stage 1 (plus de chances).
  if (!response) {
    const fallbackOrder = [
      // Modeles qui ont repondu en Stage 1, en premier (les plus fiables)
      ...stage1Results.map((r) => r.model),
      // Puis les autres du council qui n'avaient pas repondu en S1
      ...councilModels.filter((m) => !stage1Results.some((r) => r.model === m)),
    ].filter((m, idx, arr) => arr.indexOf(m) === idx && m !== chairmanModel);

    for (const fallback of fallbackOrder) {
      console.warn(`Chairman ${chairmanModel} indisponible, fallback sur ${fallback}`);
      fallbacksTried.push(fallback);
      const fallbackResponse = await queryModel(fallback, messages, queryOptions);
      if (fallbackResponse) {
        response = fallbackResponse;
        usedFallback = true;
        usedModel = fallback;
        break;
      }
    }
  }

  if (!response) {
    return {
      result: {
        model: 'error',
        response: `Erreur : impossible de generer la synthese finale. Chairman ${chairmanModel} et tous les fallbacks (${fallbacksTried.join(', ')}) sont indisponibles. Cause probable : rate limit OpenRouter sur les modeles :free. Reessaie dans quelques minutes.`,
        analysis: null,
        used_fallback: true,
        fallbacks_tried: fallbacksTried,
        duration_ms: Date.now() - stageStart,
      },
      usage: null,
    };
  }

  const rawContent = response.content || '';

  // Si l'analyse est desactivee, le retour est du markdown brut.
  // Sinon, on parse le JSON pour extraire analysis + final_answer.
  let parsed;
  if (analysisEnabled) {
    parsed = parseChairmanResponse(rawContent);
  } else {
    parsed = {
      analysis: null,
      final_answer: rawContent,
      method: 'analysis_disabled',
    };
  }

  return {
    result: {
      model: usedModel,
      response: parsed.final_answer,    // texte markdown affiche dans l'onglet "Synthese"
      analysis: parsed.analysis,        // objet structure affiche dans l'onglet "Analyse" (null si desactive)
      raw_response: rawContent,         // utile pour debug si le parsing a echoue
      parse_method: parsed.method,      // 'json' | 'fallback_text' | 'analysis_disabled'
      analysis_enabled: analysisEnabled,
      used_fallback: usedFallback,
      fallbacks_tried: fallbacksTried,
      duration_ms: response.duration_ms || (Date.now() - stageStart),
    },
    usage: response.usage,
  };
}

/**
 * Convertit les sequences d'echappement JSON (\n, \t, \", \\, ...) d'une
 * string en vrais caracteres. Utilise quand on recupere la valeur de
 * final_answer "a la main" (sans passer par JSON.parse), ou en tout dernier
 * recours pour rendre lisible un texte ou les \n sont restes litteraux.
 */
function jsonUnescape(s) {
  if (typeof s !== 'string') return s;
  try {
    // Astuce robuste : on re-parse la string comme une string JSON.
    return JSON.parse('"' + s.replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r') + '"');
  } catch {
    // Fallback manuel si le re-parse echoue.
    return s
      .replace(/\\r\\n/g, '\n')
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, '\\');
  }
}

/**
 * Extraction tolerante du champ "final_answer" dans un texte qui RESSEMBLE a
 * du JSON mais que JSON.parse refuse (JSON casse / tronque, frequent avec les
 * modeles :free). On scanne caractere par caractere a partir de la cle
 * "final_answer" pour capturer la valeur string complete, en gerant les
 * guillemets echappes. Renvoie la string brute (avec \n litteraux) ou null.
 */
function extractFinalAnswerLoose(text) {
  const keyMatch = text.match(/"final_answer"\s*:\s*"/);
  if (!keyMatch) return null;
  let i = keyMatch.index + keyMatch[0].length;
  let out = '';
  while (i < text.length) {
    const ch = text[i];
    if (ch === '\\') {
      // garde la sequence d'echappement telle quelle (on l'unescape apres)
      out += ch + (text[i + 1] || '');
      i += 2;
      continue;
    }
    if (ch === '"') break; // fin de la valeur string
    out += ch;
    i++;
  }
  return out.length ? out : null;
}

/**
 * Parse la reponse JSON du Chairman. Plusieurs filets de securite (v2.16.4)
 * pour ne JAMAIS afficher du JSON brut a l'utilisateur :
 *   1. parse JSON direct
 *   2. parse JSON dans un fence markdown
 *   3. extraction tolerante de final_answer (JSON casse / tronque)
 *   4. dernier recours : tout le texte, mais avec les \n litteraux convertis
 *      en vrais retours a la ligne (au moins c'est lisible).
 */
function parseChairmanResponse(text) {
  if (!text || typeof text !== 'string') {
    return { analysis: null, final_answer: '', method: 'empty' };
  }

  // Tentative 1 : parse direct JSON
  let parsed = tryParseJson(text);

  // Tentative 2 : JSON dans un fence markdown
  if (!parsed) {
    const fenceMatch = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (fenceMatch) {
      parsed = tryParseJson(fenceMatch[1]);
    }
  }

  // Si on a un objet avec final_answer, c'est bon
  if (parsed && typeof parsed.final_answer === 'string' && parsed.final_answer.trim()) {
    return {
      analysis: parsed.analysis || null,
      final_answer: parsed.final_answer,
      method: 'json',
    };
  }

  // Tentative 3 : le texte ressemble a du JSON mais ne parse pas.
  // On va chercher final_answer "a la main".
  if (/"final_answer"\s*:/.test(text)) {
    const loose = extractFinalAnswerLoose(text);
    if (loose && loose.trim()) {
      return {
        analysis: null,
        final_answer: jsonUnescape(loose),
        method: 'loose_extract',
      };
    }
  }

  // Tentative 4 (dernier recours) : on garde tout le texte comme synthese,
  // mais on convertit les \n litteraux en vrais retours a la ligne pour que
  // ce soit lisible (cas ou le modele a repondu en markdown direct OU ou le
  // JSON est trop casse pour en extraire quoi que ce soit).
  return {
    analysis: null,
    final_answer: /\\n/.test(text) ? jsonUnescape(text) : text,
    method: 'fallback_text',
  };
}

// ============================================================================
// Titre auto (+ theme pour le leaderboard, v2.10)
// ============================================================================

function normalizeTheme(raw) {
  const vocab = THEME_VOCAB && THEME_VOCAB.length ? THEME_VOCAB : ['divers'];
  if (!raw || typeof raw !== 'string') return 'divers';
  const t = raw.trim().toLowerCase();
  // match exact, sinon match "commence par", sinon divers
  if (vocab.includes(t)) return t;
  const starts = vocab.find((v) => t.startsWith(v) || v.startsWith(t));
  return starts || (vocab.includes('divers') ? 'divers' : vocab[vocab.length - 1]);
}

function cleanTitle(raw) {
  let title = (raw || '').trim().replace(/^["']|["']$/g, '').trim();
  if (!title) return 'Nouvelle conversation';
  return title.length <= 50 ? title : title.slice(0, 47) + '...';
}

/**
 * Genere le titre ET le theme de la conversation en UN SEUL appel (replie dans
 * l'appel de titre existant -> pas de cout supplementaire). Robuste : si le
 * tagging est desactive ou si le JSON ne parse pas, on retombe proprement sur
 * un titre texte + theme 'divers'.
 *
 * @returns {Promise<{title: string, theme: string}>}
 */
export async function generateConversationTitle(userQuery, override = {}) {
  const { titleModel } = resolveConfig(override);

  // Mode sans tagging : ancien comportement (titre texte simple) + theme divers.
  if (!THEME_TAGGING_ENABLED) {
    const response = await queryModel(titleModel, [{ role: 'user', content: titlePrompt(userQuery) }], {
      timeout: TITLE_TIMEOUT, apiKey: override.apiKey,
      maxRetries: 1,
    });
    return { title: response ? cleanTitle(response.content) : 'Nouvelle conversation', theme: 'divers' };
  }

  // Mode tagging : titre + theme en JSON.
  const response = await queryModel(
    titleModel,
    [{ role: 'user', content: titleAndThemePrompt(userQuery, THEME_VOCAB) }],
    { timeout: TITLE_TIMEOUT, apiKey: override.apiKey, maxRetries: 1, responseFormat: { type: 'json_object' } },
  );

  if (!response || !response.content) {
    return { title: 'Nouvelle conversation', theme: 'divers' };
  }

  const parsed = tryParseJson(response.content);
  if (parsed && (parsed.title || parsed.theme)) {
    return {
      title: cleanTitle(parsed.title),
      theme: normalizeTheme(parsed.theme),
    };
  }

  // Fallback : le modele a repondu en texte brut -> on l'utilise comme titre.
  return { title: cleanTitle(response.content), theme: 'divers' };
}

// ============================================================================
// Orchestration complete
// ============================================================================

export async function runFullCouncil(userQuery, override = {}) {
  const stage1 = await stage1CollectResponses(userQuery, override);

  if (stage1.results.length === 0) {
    return {
      stage1: [],
      stage2: [],
      stage3: {
        model: 'error',
        response: 'Tous les modeles ont echoue. Verifie ta cle OpenRouter et tes credits.',
        used_fallback: false,
      },
      metadata: { label_to_model: {}, aggregate_rankings: [] },
      pricing: aggregateUsage([]),
      timings: { stage1_ms: stage1.stage_duration_ms, stage2_ms: 0, stage3_ms: 0, total_ms: stage1.stage_duration_ms },
      failed_models_stage1: stage1.failed_models,
    };
  }

  const stage2 = await stage2CollectRankings(userQuery, stage1.results, override);
  const aggregateRankings = calculateAggregateRankings(stage2.rankings, stage2.labelToModel);

  const stage3 = await stage3SynthesizeFinal(userQuery, stage1.results, stage2.rankings, aggregateRankings, override);

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

  return {
    stage1: stage1.results,
    stage2: stage2.rankings,
    stage3: stage3.result,
    metadata: {
      label_to_model: stage2.labelToModel,
      aggregate_rankings: aggregateRankings,
    },
    pricing,
    timings,
    failed_models_stage1: stage1.failed_models,
  };
}
