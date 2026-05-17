# LLM Council v2 — Node.js

Inspiré du [LLM Council de Karpathy](https://github.com/karpathy/llm-council), porté en **Node.js + Fastify** pour s'aligner sur l'écosystème VPS existant (legifrance-mcp, fedlex-mcp, eurlex-mcp, uslaw-mcp, dila-mcp, loi-app, tous en Node).

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
- **Frontend** : React 19 + Vite + react-markdown + remark-gfm
- **Storage** : JSON par conversation dans `data/conversations/`
- **Pas de venv, pas de pip** : seulement `npm install` partout

## Installation locale

Prérequis : Node.js ≥ 20, une clé OpenRouter.

```bash
# Récupère le projet
cd llm-council
cp .env.example.free .env       # ou .env.example pour le mode payant
# Édite .env et renseigne au minimum OPENROUTER_API_KEY
```

Puis lance selon ton OS :

**Windows (PowerShell)**
```powershell
.\start.ps1
```

**macOS / Linux**
```bash
chmod +x start.sh
./start.sh
```

Le script installe les deps si nécessaire et lance backend + frontend.

- Backend : http://localhost:8001
- Frontend : http://localhost:5180

## Configuration

Tout est dans `.env`. Variables clés :

- `OPENROUTER_API_KEY` — requis
- `COUNCIL_MODELS` — CSV des identifiants OpenRouter
- `CHAIRMAN_MODEL` — modèle synthétiseur (externe au council recommandé)
- `EVAL_CRITERIA` — critères Stage 2 (adaptable au domaine)
- `MAX_RETRIES`, `REQUEST_TIMEOUT` (ms) — robustesse
- `CORS_ORIGINS` — origines autorisées (CSV)

Voir `.env.example` pour la liste complète.

### Mode 100% gratuit (rate-limited)

Pour tester le projet sans débourser, un `.env.example.free` est fourni — utilise `openrouter/free` (le router automatique d'OpenRouter qui sélectionne parmi les modèles gratuits en filtrant les capabilities) à la place des modèles payants.

```bash
cp .env.example.free .env
# Édite OPENROUTER_API_KEY
./start.sh
```

Rate limits OpenRouter free tier (mai 2026) : ~200 req/jour sans crédits, ~1000 req/jour après un dépôt de 10$ (qui reste en réserve, ne se consomme pas). Le Council fait 10 appels par question, donc **~20 questions/jour** sans dépôt, ~100/jour avec.

**Trois limites à connaître** avant d'utiliser le mode free :
1. **Qualité Stage 3 dégradée** — les free models sont bons mais en dessous d'Opus/GPT-5.1/Gemini 3 Pro sur la synthèse raisonnée
2. **Privacy** — la plupart des providers de modèles `:free` loggent les prompts pour entraîner leurs modèles. Inadapté pour données clients ou conformité réglementaire
3. **Disponibilité non garantie** — les modèles `:free` peuvent être retirés sans préavis

### Adaptation pour AIComply (mode juridique)

Dans `.env` :

```env
EVAL_CRITERIA=Exactitude des références citées (articles, décisions), pertinence de la qualification juridique, complétude au regard du droit applicable, clarté du raisonnement.
```

Pour brancher les MCP juridiques (Légifrance, FedLex, EUR-Lex) en pré-retrieval : fork à prévoir dans `backend/council.js`, fonction `stage1CollectResponses`. Pas inclus dans cette version.

## Déploiement VPS

Cible : `council.mesoutilsagile.com` sur le VPS `151.80.232.214`, port interne **5706**.

Table à jour des ports occupés :

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

DNS à créer **avant** : `council.mesoutilsagile.com` → `151.80.232.214`. Vérifie avec `dig council.mesoutilsagile.com +short`.

Puis depuis Windows :

```powershell
cd C:\Agile\llm-council
.\deploy-council.ps1 -Init
```

Le script va :

1. Trouver `deploy-config.json` (priorité à `C:\Agile\deploy-config.json`)
2. Tester SSH
3. Builder le frontend (`npm run build` → `frontend/dist/`)
4. Zipper en excluant `.env`, `node_modules`, `data/`, etc.
5. Uploader sur le VPS
6. Vérifier les pré-requis (Node ≥ 20, unzip)
7. Backup éventuel → rsync → `npm install --omit=dev` → PM2 delete + start
8. Health check local (HTTP 200 sur `/health`)
9. Demander la clé OpenRouter et générer le `.env` de prod
10. Créer le vhost Nginx (avec `proxy_buffering off` sur `/stream` pour le SSE)
11. Demander un email puis lancer Certbot pour le HTTPS

### Mise à jour ultérieure

```powershell
.\deploy-council.ps1
```

Le `.env` et `data/` sont préservés (backup → restore après rsync). PM2 fait `delete + start` pour relire l'env.

### Debug / options

```powershell
.\deploy-council.ps1 -SkipBuild         # frontend déjà buildé
.\deploy-council.ps1 -SkipNginx -SkipCertbot   # juste le code
.\deploy-council.ps1 -LogsAfter         # affiche pm2 logs après deploy
```

### Vérification post-deploy

```bash
ssh ubuntu@151.80.232.214 'pm2 status'
ssh ubuntu@151.80.232.214 'pm2 logs llm-council --lines 30 --nostream'
curl https://council.mesoutilsagile.com/health
```

## Architecture

```
llm-council/
├── package.json              # Deps backend (Fastify, @fastify/cors, dotenv)
├── ecosystem.config.cjs      # PM2 mode Node standard
├── deploy-council.ps1        # Script de déploiement VPS
├── start.sh                  # Démarrage dev local
├── .env.example
│
├── backend/
│   ├── server.js             # Fastify app : routes + SSE streaming
│   ├── config.js             # Variables d'env, modèles, critères
│   ├── openrouter.js         # Client fetch + retry + pricing
│   ├── council.js            # 3 stages + structured output + Borda count
│   ├── pricing.js            # Agrégation des coûts
│   ├── prompts.js            # Prompts FR
│   └── storage.js            # JSON persistence atomique
│
└── frontend/
    ├── package.json
    ├── vite.config.js
    ├── index.html
    └── src/
        ├── App.jsx
        ├── api.js
        ├── main.jsx
        ├── index.css
        └── components/
            ├── Sidebar.jsx
            ├── ChatInterface.jsx
            ├── Stage1.jsx
            ├── Stage2.jsx
            └── Stage3.jsx
```

## Endpoints API

- `GET /` — health
- `GET /health` — health (Nginx upstream)
- `GET /api/config` — config publique (modèles, critères)
- `GET /api/conversations` — liste meta
- `POST /api/conversations` — crée
- `GET /api/conversations/:id` — détail
- `DELETE /api/conversations/:id` — supprime
- `POST /api/conversations/:id/message` — pipeline complet (blocking)
- `POST /api/conversations/:id/message/stream` — pipeline en SSE (recommandé)

## Coût estimé par requête

4 modèles × (Stage 1 + Stage 2) + 1 chairman + 1 titre ≈ **10 appels par question**.

Selon la longueur et le mix de modèles : **environ 0,15 € à 0,40 € par question** pour des réponses moyennes. Le coût exact est affiché dans l'UI à la fin de chaque pipeline (`usage.cost` renvoyé par OpenRouter).

## Limitations connues

1. **Anonymisation imparfaite** : si un modèle se signe au milieu d'une réponse (pas seulement au début), le strip ne le détecte pas.
2. **Structured output best-effort** : OpenRouter supporte `json_object` sur la plupart des modèles modernes, mais pas tous. Le fallback regex prend le relais sans casser le pipeline.
3. **Borda count basique** : moyenne des positions sans pondération. OK en POC, perfectible (Condorcet, Schulze) si volume.
4. **Pas de streaming token-par-token** : le streaming est par stage. Pour du token-by-token, il faudrait passer `stream: true` aux appels OpenRouter et multiplexer.
5. **MCP juridiques non branchés** : version généraliste. Pour AIComply, fork à prévoir.

## Licence

À définir.
