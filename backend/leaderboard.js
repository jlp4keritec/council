// Leaderboard data-driven par thème.
// Agrege, par couple (theme, modele), les classements Stage 2 de chaque
// deliberation. Objectif : a terme, un classement empirique par domaine
// (cf. roadmap/leaderboard-par-theme.md), puis un routeur de conseil.
//
// Ecriture atomique (tmp + rename), comme storage.js. Mono-utilisateur :
// last-write-wins acceptable. Toute erreur est non bloquante cote pipeline
// (cf. l'appel enrobe en try/catch dans server.js).

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { LEADERBOARD_FILE } from './config.js';

export const LEADERBOARD_SCHEMA_VERSION = 1;

function emptyStore() {
  return {
    schema_version: LEADERBOARD_SCHEMA_VERSION,
    updated_at: null,
    total_deliberations: 0,
    themes: {},   // theme -> { deliberations, models: { modelId -> stats } }
  };
}

function emptyModelStats() {
  return {
    deliberations: 0,   // nb de deliberations ou ce modele a ete classe
    rank_sum: 0,        // somme des average_rank (pour la moyenne)
    wins: 0,            // nb de fois classe 1er (meilleur average_rank de la deliberation)
    evaluations: 0,     // somme des rankings_count (pour la significativite statistique)
    last_updated: null,
  };
}

async function readStore() {
  try {
    const raw = await readFile(LEADERBOARD_FILE, 'utf-8');
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object' || !data.themes) return emptyStore();
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
}

async function writeStore(store) {
  await mkdir(dirname(LEADERBOARD_FILE), { recursive: true });
  const tmp = LEADERBOARD_FILE + '.tmp';
  await writeFile(tmp, JSON.stringify(store, null, 2), 'utf-8');
  await rename(tmp, LEADERBOARD_FILE);
}

/**
 * Enregistre une deliberation dans le leaderboard.
 *
 * @param {object} params
 * @param {string} params.theme               theme normalise (ex: 'droit')
 * @param {Array<{model, average_rank, rankings_count}>} params.aggregateRankings
 *        le classement agrege Stage 2 (plus bas average_rank = meilleur)
 * @returns {Promise<boolean>} true si enregistre, false si rien a faire
 */
export async function recordDeliberation({ theme, aggregateRankings }) {
  if (!Array.isArray(aggregateRankings) || aggregateRankings.length === 0) return false;
  const safeTheme = (typeof theme === 'string' && theme.trim()) ? theme.trim() : 'divers';
  const now = new Date().toISOString();

  const store = await readStore();

  if (!store.themes[safeTheme]) {
    store.themes[safeTheme] = { deliberations: 0, models: {} };
  }
  const themeBucket = store.themes[safeTheme];
  themeBucket.deliberations += 1;
  store.total_deliberations += 1;
  store.updated_at = now;

  // Le gagnant de cette deliberation = average_rank le plus bas.
  const bestRank = Math.min(...aggregateRankings.map((a) => a.average_rank));

  for (const entry of aggregateRankings) {
    const { model, average_rank, rankings_count } = entry;
    if (!model || typeof average_rank !== 'number') continue;

    if (!themeBucket.models[model]) {
      themeBucket.models[model] = emptyModelStats();
    }
    const s = themeBucket.models[model];
    s.deliberations += 1;
    s.rank_sum += average_rank;
    s.evaluations += Number.isInteger(rankings_count) ? rankings_count : 0;
    if (average_rank === bestRank) s.wins += 1;
    s.last_updated = now;
  }

  await writeStore(store);
  return true;
}

/**
 * Renvoie le leaderboard calcule (lecture seule), par theme, modeles tries
 * du meilleur (mean_rank le plus bas) au moins bon.
 *
 * @param {object} [opts]
 * @param {number} [opts.minDeliberations=1] seuil de significativite par modele
 */
export async function getLeaderboard(opts = {}) {
  const minDeliberations = Number.isInteger(opts.minDeliberations) ? opts.minDeliberations : 1;
  const store = await readStore();

  const themes = {};
  for (const [theme, bucket] of Object.entries(store.themes)) {
    const models = Object.entries(bucket.models)
      .map(([model, s]) => ({
        model,
        mean_rank: s.deliberations > 0 ? Number((s.rank_sum / s.deliberations).toFixed(3)) : null,
        deliberations: s.deliberations,
        wins: s.wins,
        win_rate: s.deliberations > 0 ? Number((s.wins / s.deliberations).toFixed(3)) : 0,
        evaluations: s.evaluations,
        significant: s.deliberations >= minDeliberations,
        last_updated: s.last_updated,
      }))
      .sort((a, b) => {
        if (a.mean_rank == null) return 1;
        if (b.mean_rank == null) return -1;
        return a.mean_rank - b.mean_rank;
      });

    themes[theme] = { deliberations: bucket.deliberations, models };
  }

  return {
    schema_version: store.schema_version || LEADERBOARD_SCHEMA_VERSION,
    updated_at: store.updated_at,
    total_deliberations: store.total_deliberations || 0,
    min_deliberations: minDeliberations,
    themes,
  };
}
