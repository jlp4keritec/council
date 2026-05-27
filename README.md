# LLM Council — Node.js

> **État courant : v2.9.1** — voir [`CHANGELOG.md`](./CHANGELOG.md) pour l'historique détaillé.

Inspiré du [LLM Council de Karpathy](https://github.com/karpathy/llm-council), porté en **Node.js + Fastify** pour s'aligner sur l'écosystème VPS existant (legifrance-mcp, fedlex-mcp, eurlex-mcp, uslaw-mcp, dila-mcp, loi-app, tous en Node).

Le principe : plusieurs LLM donnent un avis (Stage 1), s'évaluent mutuellement en aveugle (Stage 2), puis un Chairman externe synthétise (Stage 3). Outil mono-utilisateur, conçu pour la délibération assistée (usage juridique / AIComply notamment).

## Différences vs version originale Karpathy

| Aspect | Karpathy | Cette version |
|---|---|---|
| Stack | Python FastAPI | **Node.js Fastify** |
| Stage 2 parsing | Regex `FINAL RANKING:` sur texte libre | `response_format: json_object` + parsing JSON + fallback regex |
| Anonymisation | Labels A/B/C/D seuls | Labels + strip des signatures (`As Claude...`, `I'm Gemini...`) |
| Chairman | Membre du council par défaut (biais) | **Externe par défaut** + fallback auto si indispo |
| Retry | Aucun | Backoff exponentiel + jitter sur 429/5xx |
| Pricing | Pas tracké | `usage.include` à chaque appel, agrégation par stage + total |
| Persistence | `label_to_model` perdu au reload | Tout persisté (meta + pricing) |
| Prompts | EN, critères codés en dur | **FR** + critères configurables via `EVAL_CRITERIA` |
| Storage | `json.dump` direct | Écriture atomique (tmp + rename) |
| Logs | `print()` | Pino structuré via Fastify |

## Stack

- **Backend** : [Fastify 5](https://fastify.dev) + fetch natif (Node 20+) + AbortController + dotenv
- **Frontend** : React 19 + Vite 7 + react-markdown + remark-gfm
- **Auth** : mono-utilisateur (login `admin` / `OPENROUTER_API_KEY`, cookie signé HMAC)
- **Storage** : JSON par conversation dans `data/conversations/`
- **Pas de venv, pas de pip** : seulement `npm install` partout
- **Polices UI** : Bricolage Grotesque (titres), Hanken Grotesk (texte), Geist Mono (métriques)

## Installation locale

Prérequis : Node.js ≥ 20, une clé OpenRouter.

```bash
cd llm-council
cp .env.example.free .env       # ou .env.example pour le mode payant
# Édite .env et renseigne au minimum OPENROUTER_API_KEY
```

Puis lance selon ton OS :

**Windows (PowerShell)**
```powershell
.\start.ps1            # vérifie/installe les deps puis lance backend + frontend
.\start.ps1 -SkipInstall   # saute npm install si déjà fait
```

**macOS / Linux**
```bash
chmod +x start.sh
./start.sh
```

- Backend : http://localhost:8001
- Frontend : http://localhost:5180  ← ouvrir dans le navigateur
- Connexion : `admin` / valeur de `OPENROUTER_API_KEY`

En dev, pas de build nécessaire (Vite recharge à chaud). `npm run build` ne sert que pour le déploiement.

## Interface (v2.9)

- **Thème pastel** bleu / blanc / rouge, appliqué via les variables CSS `:root` (la sidebar, les modales et le login se retintent automatiquement).
- **Deux dispositions** commutables par un toggle en haut à droite, **persistées** (clé localStorage `council-view`) :
  - **Tableau** — 3 panneaux côte à côte par réponse : Conseil (Stage 1) / Classement (Stage 2) / Synthèse (Stage 3) ;
  - **Lecture** — panneaux empilés dans une colonne centrée.
  - Sous 1180 px : empilement automatique, toggle masqué.
- **Stage 2 en liste rangée** construite sur le rang moyen réel (`aggregate_rankings`, plus bas = meilleur) ; le détail par évaluateur (forces / faiblesses anonymisées) reste accessible dans un repli.
- **3 conseils prédéfinis** dans le modal Configuration (Diversité max / Raisonnement / Conseil actuel — familles d'entraînement décorrélées) + bouton « Défaut (.env serveur) ». Un preset crée un *override navigateur* ; le défaut permanent reste le `.env`.
- **Version** affichée en bas de la sidebar → clic = modale **« À propos »** qui lit le `CHANGELOG.md`.

## Configuration

Tout est dans `.env` (lu **au démarrage** du backend — redémarrer après modification). Variables clés :

- `OPENROUTER_API_KEY` — requis (sert aussi de mot de passe admin)
- `COUNCIL_MODELS` — CSV des identifiants OpenRouter (membres du conseil)
- `CHAIRMAN_MODEL` — modèle synthétiseur (externe au council recommandé)
- `TITLE_MODEL` — modèle de génération des titres
- `CHAIRMAN_ANALYSIS_ENABLED` — `true`/`false` (analyse méta-cognitive du Chairman)
- `EVAL_CRITERIA` — critères Stage 2 (adaptable au domaine)
- `MAX_RETRIES`, `REQUEST_TIMEOUT` (ms) — robustesse
- `CORS_ORIGINS` — origines autorisées (CSV)

Voir `.env.example` pour la liste complète.

> **Override navigateur vs `.env`.** Le modal Configuration enregistre un *override* dans le localStorage du navigateur, qui **prime** sur le `.env`. Le `.env` reste la source de vérité du défaut serveur (utilisé en l'absence d'override, sur tout navigateur). Pour faire d'un preset le défaut permanent, reporter ses valeurs dans le `.env`.

### Conseils prédéfinis (presets du modal)

Trois conseils à familles décorrélées, tous en modèles `:free` (à vérifier/ajuster via la recherche du modal, les slugs `:free` tournent) :

- **Diversité max** : DeepSeek · Qwen · Meta · Z.ai — Chairman OpenAI
- **Raisonnement** : DeepSeek V4 · Qwen · NVIDIA · Arcee — Chairman Meta
- **Conseil actuel** : tes 4 membres — Chairman GLM (indépendant)

### Mode 100% gratuit (rate-limited)

`.env.example.free` est fourni. Rate limits OpenRouter free tier (≈ 200 req/jour sans crédits, ≈ 1000 après un dépôt de 10 $ qui reste en réserve). Le Council fait ~10 appels par question → **~20 questions/jour** sans dépôt, ~100/jour avec.

**Trois limites du mode free :**
1. **Qualité Stage 3** un cran sous les modèles top-tier payants sur la synthèse raisonnée.
2. **Privacy** — la plupart des providers `:free` loggent les prompts. Inadapté aux données clients / conformité.
3. **Disponibilité non garantie** — les modèles `:free` peuvent être retirés sans préavis.

### Adaptation pour AIComply (mode juridique)

```env
EVAL_CRITERIA=Exactitude des références citées (articles, décisions), pertinence de la qualification juridique, complétude au regard du droit applicable, clarté du raisonnement.
```

Pour brancher les MCP juridiques (Légifrance, FedLex, EUR-Lex) en pré-retrieval : fork à prévoir dans `backend/council.js`, fonction `stage1CollectResponses`. Pas inclus dans cette version.

## Déploiement VPS

Cible : `council.mesoutilsagile.com` sur le VPS `151.80.232.214`, port interne **5706**.

| Port | Service | Sous-domaine |
|---|---|---|
| 5700 | legifrance-mcp | legifrance.mesoutilsagile.com |
| 5701 | fedlex-mcp | fedlex.mesoutilsagile.com |
| 5702 | eurlex-mcp | eurlex.mesoutilsagile.com |
| 5703 | uslaw-mcp | uslaw.mesoutilsagile.com |
| 5704 | loi-app | loi.mesoutilsagile.com |
| 5705 | dila-mcp | dila.mesoutilsagile.com |
| **5706** | **llm-council** | **council.mesoutilsagile.com** |

### Premier déploiement

DNS à créer **avant** : `council.mesoutilsagile.com` → `151.80.232.214`.

```powershell
cd C:\Agile\llm-council
Unblock-File -Path .\deploy-council.ps1
.\deploy-council.ps1 -Init
```

Le script : trouve `deploy-config.json` → SSH → build frontend (`npm run build` → `frontend/dist/`) → zip (exclut `.env`, `node_modules`, `data/`…) → upload → backup → rsync → `npm install --omit=dev` → PM2 delete + start → health check → vhost Nginx (`proxy_buffering off` sur le SSE) → Certbot HTTPS.

### Mise à jour ultérieure

```powershell
Unblock-File -Path .\deploy-council.ps1
.\deploy-council.ps1          # sans -SkipBuild si le frontend a changé
```

Le `.env` et `data/` du VPS sont **préservés** (backup → restore après rsync). Donc un changement de `COUNCIL_MODELS`/`CHAIRMAN_MODEL` local **n'est pas propagé** : éditer le `.env` du VPS séparément si besoin, puis `pm2 restart llm-council --update-env`.

### Vérification post-deploy

`Ctrl+Shift+R` sur la prod (cache), puis : toggle Lecture/Tableau, badge version `v2.9.1` + modale « À propos », presets du modal, une délibération qui s'affiche.

```bash
ssh ubuntu@151.80.232.214 'pm2 status'
ssh ubuntu@151.80.232.214 'pm2 logs llm-council --lines 30 --nostream'
curl https://council.mesoutilsagile.com/health
```

## Versioning

Voir `CHANGELOG.md` (format Keep a Changelog). Convention : à chaque feature, ajouter sa ligne dans la section `## [Unreleased]` **dans le même commit que le code**. À la release : renommer `[Unreleased]` en `[X.Y.Z] - AAAA-MM-JJ`, recréer un `[Unreleased]` vide, bumper les deux `package.json`, tagger `vX.Y.Z`. La modale « À propos » affiche la version (`__APP_VERSION__`, injecté depuis `frontend/package.json`) et rend le CHANGELOG.

## Architecture

```
llm-council/
├── package.json              # Deps backend (Fastify, @fastify/cors, dotenv, docx, pptxgenjs)
├── CHANGELOG.md              # Historique des versions (Keep a Changelog)
├── ecosystem.config.cjs      # PM2 mode Node standard
├── deploy-council.ps1        # Script de déploiement VPS
├── start.ps1 / start.sh      # Démarrage dev local
├── .env.example / .env.example.free
│
├── roadmap/                  # Idées et pistes d'évolution (1 fiche = 1 .md)
│   ├── README.md
│   └── leaderboard-par-theme.md
│
├── backend/
│   ├── server.js             # Fastify app : routes + SSE streaming
│   ├── auth.js               # Auth mono-user (cookie signé)
│   ├── config.js             # Variables d'env, modèles, critères
│   ├── openrouter.js         # Client fetch + retry + pricing
│   ├── council.js            # 3 stages + structured output + Borda count
│   ├── exporters.js          # Export MD / JSON / DOCX / PPTX
│   ├── pricing.js            # Agrégation des coûts
│   ├── quota.js              # Quota quotidien + détection mode OpenRouter
│   ├── prompts.js            # Prompts FR
│   └── storage.js            # JSON persistence atomique
│
└── frontend/
    ├── package.json          # version = source de __APP_VERSION__
    ├── vite.config.js        # injecte __APP_VERSION__ + proxy /api + fs.allow ('..')
    ├── index.html            # + polices Google
    ├── public/landing.html
    └── src/
        ├── App.jsx           # racine : auth + modales (Config, QuotaHelp, About)
        ├── api.js            # client API (Content-Type JSON seulement si corps)
        ├── main.jsx
        ├── index.css         # thème pastel + 2 dispositions
        └── components/
            ├── Login.jsx / Login.css
            ├── Sidebar.jsx         # + badge version cliquable
            ├── ChatInterface.jsx   # toggle vue + board par réponse + metrics
            ├── Stage1.jsx          # panneau Conseil
            ├── Stage2.jsx          # panneau Classement (liste rangée)
            ├── Stage3.jsx          # panneau Synthèse (+ Analyse Chairman)
            ├── ModelSelector.jsx   # config + 3 presets
            ├── QuotaHelp.jsx
            └── About.jsx           # modale À propos (lit CHANGELOG.md)
```

## Endpoints API

- `GET /` · `GET /health` — health (Nginx upstream)
- `GET /api/config` — config publique (modèles, critères)
- `GET /api/usage` — quota / statut OpenRouter
- `GET /api/models` · `POST /api/models/health` — recherche / health-check modèles
- `GET /api/conversations` — liste meta
- `POST /api/conversations` — crée
- `GET /api/conversations/:id` — détail
- `DELETE /api/conversations/:id` — supprime
- `GET /api/conversations/:id/export` — export (MD/JSON/DOCX/PPTX)
- `POST /api/conversations/:id/message` — pipeline complet (blocking)
- `POST /api/conversations/:id/message/stream` — pipeline en SSE (recommandé)
- `POST /api/auth/login` · `GET /api/auth/me` · `POST /api/auth/logout`

## Roadmap

Voir le dossier [`roadmap/`](./roadmap/). En tête de liste : un **leaderboard par thème data-driven** — persister les classements Stage 2 étiquetés par thème pour, à terme, composer dynamiquement le conseil sur des données réelles (cf. [`roadmap/leaderboard-par-theme.md`](./roadmap/leaderboard-par-theme.md)). À démarrer une fois assez de délibérations accumulées.

## Limitations connues

1. **Anonymisation imparfaite** : signature en milieu de réponse non détectée par le strip.
2. **Structured output best-effort** : fallback regex si un modèle ne respecte pas `json_object`.
3. **Borda count basique** : moyenne des positions sans pondération (perfectible : Condorcet, Schulze).
4. **Pas de streaming token-par-token** : le streaming est par stage.
5. **MCP juridiques non branchés** : version généraliste (fork à prévoir pour AIComply).

## Licence

À définir.
