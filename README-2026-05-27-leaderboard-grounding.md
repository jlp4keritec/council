# v2.10.0 — Leaderboard par thème (data-driven) + Grounding juridique MCP

Date : 2026-05-27

Deux features backend. Aucune modification du frontend (hors bump de version).

## Fichiers de cette livraison

### Backend modifiés (écraser)
- `backend/config.js` ...... + variables leaderboard (THEME_*, LEADERBOARD_FILE) et grounding (GROUNDING_*)
- `backend/prompts.js` ..... + `titleAndThemePrompt` (titre+thème en 1 appel) + `groundingSystemPrompt`
- `backend/council.js` ..... `generateConversationTitle` renvoie {title, theme} ; grounding injecté au Stage 1 (fail-open)
- `backend/storage.js` ..... champ `theme` sur la conversation ; `updateConversationTitle(id, title, theme?)`
- `backend/server.js` ...... câblage titre+thème, enregistrement leaderboard (non bloquant), route `GET /api/leaderboard`, grounding remonté en SSE/metadata

### Backend nouveaux (ajouter)
- `backend/leaderboard.js` . agrégation (thème, modèle) -> data/leaderboard.json (écriture atomique, fail-open)
- `backend/retrieval.js` ... client MCP de grounding (fail-open total : ne throw jamais)

### Racine / config (écraser)
- `package.json` ........... version 2.10.0 + dépendance `@modelcontextprotocol/sdk`
- `frontend/package.json` .. version 2.10.0
- `.env.example` .......... + blocs leaderboard et grounding (documentés)
- `CHANGELOG.md` .......... entrée 2.10.0
- `roadmap/leaderboard-par-theme.md` . étapes 1-2 marquées livrées

## Installation
Décompresser à la racine du projet (écrase / ajoute les fichiers ci-dessus).

⚠️ **Nouvelle dépendance backend** -> il FAUT réinstaller les deps backend :
```bash
npm install
```
(En prod, `deploy-council.ps1` fait `npm install --omit=dev` automatiquement.)

## Feature 1 — Leaderboard par thème (ACTIF par défaut)
- Le thème est déduit en même temps que le titre (0 appel API en plus).
- Données accumulées dans `data/leaderboard.json` dès la 1re délibération.
- Lecture : `GET /api/leaderboard` (protégé par l'auth, comme le reste).
- Désactivable via `THEME_TAGGING_ENABLED=false` (thème="divers").
- Vérifié : test unitaire d'agrégation OK (tri par rang moyen, wins, win-rate, évaluations, seuil).

## Feature 2 — Grounding juridique MCP (DÉSACTIVÉ par défaut)
- Reste inactif tant que `GROUNDING_ENABLED=true` + `GROUNDING_MCP_URL` ne sont pas définis.
- Fail-open : toute erreur de retrieval -> le conseil répond sans sources (jamais de casse).
- Vérifié : désactivé -> null ; URL injoignable -> warning + null, sans exception.
- ⚠️ NON testable en live depuis l'environnement de dev (pas d'accès au VPS).
  À l'activation, lancer 1 question et vérifier `pm2 logs`. Si l'outil/param diffèrent,
  ajuster `GROUNDING_MCP_TOOL` / `GROUNDING_MCP_QUERY_PARAM` / `GROUNDING_MCP_AUTH` dans le `.env`.
  Défauts visés : DILA, outil `dila_search_semantic`, paramètre `query`.

## Build / deploy
```bash
npm install            # deps backend (nouvelle dép MCP SDK)
cd frontend && npm run build
```
Puis déploiement habituel : `Unblock-File .\deploy-council.ps1 ; .\deploy-council.ps1` (sans -SkipBuild).
