# README — Cortex configurable par utilisateur (v2.17.0)

**Date :** 29 mai 2026
**Version :** 2.17.0
**Type :** fonctionnalité (feat)

---

## But

Permettre à **chaque utilisateur** de configurer **son propre Cortex** (URL +
token) depuis la page « Mon compte », au lieu d'un token global dans le `.env`.

Avant : le token Cortex venait uniquement du `.env` (`CORTEX_MCP_TOKEN`). En
production il était absent → erreur 502 « impossible d'écrire dans Cortex ».

## Principe

Exactement le **même mécanisme que la clé OpenRouter** (déjà en place) :
- Le token Cortex est **chiffré** côté serveur (AES-256-GCM).
- L'API ne renvoie **jamais** le token, seulement `has_cortex: true/false` et l'URL.
- Filet de sécurité **admin** : si pas de config perso, on retombe sur le `.env`.

## Ce que voit l'utilisateur

Nouveau bloc **« 🧠 Mon Cortex »** dans Mon compte :
- Champ **URL Cortex** (pré-rempli avec `https://cortex.mesoutilsagile.com`).
- Champ **Token Cortex** (masqué).
- Bouton **« Tester »** → vérifie la connexion (handshake MCP, sans créer de note).
- Bouton **Enregistrer** / **Remplacer** / **Supprimer**.
- Badge d'état : ✓ configuré / ⚠ non configuré.

## Fonctions ajoutées / modifiées

### Backend

| Fichier | Fonction | Changement |
|---|---|---|
| `users.js` | `setCortexConfig(userId, url, token)` | **Nouveau** — enregistre URL + token chiffré. |
| `users.js` | `clearCortexConfig(userId)` | **Nouveau** — efface la config. |
| `users.js` | `getCortexConfig(userId)` | **Nouveau** — renvoie `{url, token}` déchiffré (serveur only). |
| `users.js` | `publicUser`, `createUser` | Ajout des champs `has_cortex`, `cortex_url`, `cortex_token_enc`. |
| `cortex.js` | `createCortexNote(note, conn)` | Accepte `conn = {url, token}` (override du `.env`). |
| `cortex.js` | `pushConversationToCortex(conv, idx, conn)` | Propage la config utilisateur. |
| `cortex.js` | `testCortexConnection(conn)` | **Nouveau** — handshake MCP seul, pour le bouton Tester. |
| `cortex.js` | `rpc(...)` | Accepte `conn` (url + token par appel). |
| `auth.js` | routes `/api/auth/cortex-config` (GET/PUT/DELETE) + `/test` | **Nouveau** — gérer la config Cortex. |
| `auth.js` | `/api/auth/me` | Renvoie aussi `has_cortex` + `cortex_url`. |
| `server.js` | `resolveCortexConfig(reqUser)` | **Nouveau** — config user, sinon `.env` pour admin. |
| `server.js` | route `to-cortex` | Utilise la config Cortex de l'utilisateur. |

> ⚠️ `server.js` inclut aussi le **fix v2.16.3** (titre en texte) déjà déployé —
> il est conservé, rien n'est perdu.

### Frontend

| Fichier | Changement |
|---|---|
| `api.js` | Wrappers `authGetCortexConfig`, `authSetCortexConfig`, `authClearCortexConfig`, `authTestCortexConfig`. |
| `AccountPage.jsx` | Nouveau bloc « 🧠 Mon Cortex » (URL + token + tester + supprimer). |

## Fichiers à remplacer

```
backend/server.js
backend/users.js
backend/cortex.js
backend/auth.js
frontend/src/api.js
frontend/src/components/AccountPage.jsx
```

## À savoir

- Le `.env` peut garder `CORTEX_MCP_URL` / `CORTEX_MCP_TOKEN` (filet admin), ou pas.
- Les comptes existants n'ont pas de config Cortex → badge ⚠ tant qu'ils ne la
  renseignent pas. Aucune migration de données nécessaire.
