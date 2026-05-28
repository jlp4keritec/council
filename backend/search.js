// Recherche dans les conversations stockees (v2.13.0).
//
// Critères combinables (tous optionnels) :
//   - q          : mot-cle (titre, questions, reponses du conseil, synthese)
//   - date_from  : 'YYYY-MM-DD' (inclus)
//   - date_to    : 'YYYY-MM-DD' (inclus, jusqu'a 23:59:59)
//   - judge      : id complet d'un modele du conseil (stage1)
//   - chairman   : id complet du modele de synthese (stage3)
//
// Si AUCUN critere n'est fourni -> on renvoie quand meme la liste (toutes les
// conversations de l'utilisateur), pour permettre un simple parcours filtre par date.
//
// Matching mot-cle insensible CASSE + ACCENTS, avec position exacte pour le
// surlignage cote frontend.
//
// Expose aussi getSearchFacets(user) : la liste des juges et presidents
// reellement presents dans l'historique de l'utilisateur (pour les menus).

import * as storage from './storage.js';

const MAX_RESULTS = 200;
const MAX_SNIPPETS_PER_CONV = 4;
const CONTEXT_BEFORE = 50;
const CONTEXT_AFTER = 130;
const ELLIPSIS = '\u2026';

// ---------------------------------------------------------------------------
// Folding (minuscule + sans accents) avec table d'index -> texte original
// ---------------------------------------------------------------------------
function fold(str) {
  const chars = [];
  const map = [];
  for (let i = 0; i < str.length; i++) {
    const norm = str[i].normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    for (const ch of norm) { chars.push(ch); map.push(i); }
  }
  return { folded: chars.join(''), map };
}

function findMatch(text, foldedQuery) {
  if (!text || typeof text !== 'string' || !foldedQuery) return null;
  const { folded, map } = fold(text);
  const pos = folded.indexOf(foldedQuery);
  if (pos === -1) return null;
  return { start: map[pos], end: map[pos + foldedQuery.length - 1] + 1 };
}

function buildSnippet(text, match, foldedQuery) {
  const rawStart = Math.max(0, match.start - CONTEXT_BEFORE);
  const rawEnd = Math.min(text.length, match.end + CONTEXT_AFTER);
  const cleaned = text.slice(rawStart, rawEnd).replace(/\s+/g, ' ').trim();
  const { folded, map } = fold(cleaned);
  const localPos = folded.indexOf(foldedQuery);
  let matchStart = 0, matchEnd = 0;
  if (localPos !== -1) {
    matchStart = map[localPos];
    matchEnd = map[localPos + foldedQuery.length - 1] + 1;
  }
  const prefix = rawStart > 0 ? ELLIPSIS + ' ' : '';
  const suffix = rawEnd < text.length ? ' ' + ELLIPSIS : '';
  return {
    text: prefix + cleaned + suffix,
    matchStart: matchStart + prefix.length,
    matchEnd: matchEnd + prefix.length,
  };
}

function shortModel(id) {
  if (!id) return 'IA';
  return String(id).split('/').pop();
}

// Apercu neutre (sans surlignage) quand il n'y a pas de mot-cle.
function plainSnippet(text, where) {
  if (!text) return null;
  const cleaned = String(text).replace(/\s+/g, ' ').trim();
  const cut = cleaned.length > 160 ? cleaned.slice(0, 159).trim() + ' ' + ELLIPSIS : cleaned;
  return { where, text: cut, matchStart: 0, matchEnd: 0 };
}

// ---------------------------------------------------------------------------
// Filtres
// ---------------------------------------------------------------------------
function inDateRange(iso, fromStr, toStr) {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return false;
  if (fromStr) {
    const from = new Date(fromStr + 'T00:00:00').getTime();
    if (!Number.isNaN(from) && t < from) return false;
  }
  if (toStr) {
    const to = new Date(toStr + 'T23:59:59.999').getTime();
    if (!Number.isNaN(to) && t > to) return false;
  }
  return true;
}

function convHasJudge(conv, judgeId) {
  if (!judgeId) return true;
  for (const msg of conv.messages || []) {
    if (msg.role !== 'assistant') continue;
    for (const r of msg.stage1 || []) {
      if (r.model === judgeId) return true;
    }
  }
  return false;
}
function convHasChairman(conv, chairmanId) {
  if (!chairmanId) return true;
  for (const msg of conv.messages || []) {
    if (msg.role !== 'assistant') continue;
    if (msg.stage3 && msg.stage3.model === chairmanId) return true;
  }
  return false;
}

/**
 * Recherche filtree.
 * @param {object} criteria - { q, date_from, date_to, judge, chairman }
 * @param {object} user - { id, is_admin } : ne cherche que dans ses conversations
 */
export async function searchConversations(criteria, user) {
  const c = criteria || {};
  const q = (c.q || '').trim();
  const foldedQuery = q.length >= 2 ? fold(q).folded : '';
  const hasKeyword = foldedQuery.length > 0;

  const dateFrom = c.date_from || null;
  const dateTo = c.date_to || null;
  const judge = c.judge || null;
  const chairman = c.chairman || null;

  const list = await storage.listConversations(user);
  const results = [];

  for (const item of list) {
    if (results.length >= MAX_RESULTS) break;
    if (!inDateRange(item.created_at, dateFrom, dateTo)) continue;

    const conv = await storage.getConversation(item.id);
    if (!conv) continue;
    if (!convHasJudge(conv, judge)) continue;
    if (!convHasChairman(conv, chairman)) continue;

    const snippets = [];

    if (hasKeyword) {
      if (conv.title) {
        const m = findMatch(conv.title, foldedQuery);
        if (m) snippets.push({ where: 'Titre', ...buildSnippet(conv.title, m, foldedQuery) });
      }
      for (const msg of conv.messages || []) {
        if (snippets.length >= MAX_SNIPPETS_PER_CONV) break;
        if (msg.role === 'user') {
          const m = findMatch(msg.content, foldedQuery);
          if (m) snippets.push({ where: 'Votre question', ...buildSnippet(msg.content, m, foldedQuery) });
          continue;
        }
        if (msg.role === 'assistant') {
          for (const r of msg.stage1 || []) {
            if (snippets.length >= MAX_SNIPPETS_PER_CONV) break;
            if (judge && r.model !== judge) continue;
            const m = findMatch(r.response, foldedQuery);
            if (m) snippets.push({ where: `Juge \u2014 ${shortModel(r.model)}`, ...buildSnippet(r.response, m, foldedQuery) });
          }
          if (snippets.length < MAX_SNIPPETS_PER_CONV && msg.stage3 && msg.stage3.response) {
            if (!chairman || msg.stage3.model === chairman) {
              const m = findMatch(msg.stage3.response, foldedQuery);
              if (m) snippets.push({ where: 'Synth\u00e8se (pr\u00e9sident)', ...buildSnippet(msg.stage3.response, m, foldedQuery) });
            }
          }
        }
      }
      if (snippets.length === 0) continue; // mot-cle introuvable ici
    } else {
      const firstUser = (conv.messages || []).find((m) => m.role === 'user');
      const lastAssistant = [...(conv.messages || [])].reverse().find((m) => m.role === 'assistant');
      const s1 = firstUser ? plainSnippet(firstUser.content, 'Question') : null;
      const s2 = lastAssistant && lastAssistant.stage3
        ? plainSnippet(lastAssistant.stage3.response, 'Synth\u00e8se (pr\u00e9sident)') : null;
      if (s1) snippets.push(s1);
      if (s2) snippets.push(s2);
    }

    results.push({
      id: conv.id,
      title: conv.title || 'Sans titre',
      created_at: conv.created_at,
      match_count: snippets.length,
      snippets: snippets.slice(0, MAX_SNIPPETS_PER_CONV),
    });
  }

  return results;
}

/**
 * Liste les "juges" et "presidents" reellement presents dans l'historique.
 * @returns {Promise<{ judges: {id,label}[], chairmen: {id,label}[] }>}
 */
export async function getSearchFacets(user) {
  const list = await storage.listConversations(user);
  const judges = new Set();
  const chairmen = new Set();

  for (const item of list) {
    const conv = await storage.getConversation(item.id);
    if (!conv) continue;
    for (const msg of conv.messages || []) {
      if (msg.role !== 'assistant') continue;
      for (const r of msg.stage1 || []) {
        if (r.model) judges.add(r.model);
      }
      if (msg.stage3 && msg.stage3.model) chairmen.add(msg.stage3.model);
    }
  }

  const toOptions = (set) => [...set].sort().map((id) => ({ id, label: shortModel(id) }));
  return { judges: toOptions(judges), chairmen: toOptions(chairmen) };
}
