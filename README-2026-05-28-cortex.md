# README — 2026-05-28 — Envoi vers Cortex

**Fonction principale : `pushConversationToCortex`** (backend `cortex.js`)
**Bouton : « 🧠 → Cortex »** (à côté des exports)
**Version : v2.11.0**

> ⚠️ Ce ZIP contient **aussi** la fonctionnalité Recherche (v2.10) livrée juste avant,
> pour que tu aies un ensemble cohérent. Remplace simplement les fichiers.

---

## En 2 phrases

À côté des boutons d'export d'une réponse, un bouton **« 🧠 → Cortex »** envoie la
délibération complète (ta question + les avis du conseil + la synthèse de la
présidente) dans ton second cerveau Cortex. La note arrive dans `inbox/`, bien
mise en forme, prête à être relue.

---

## Avant de tester : 1 réglage (la clé)

Le serveur Council a besoin du **token de Cortex** pour écrire dedans. C'est exactement
le `MCP_TOKEN` que tu utilises déjà pour le smoke-test de Cortex.

1. Ouvre le fichier **`.env`** de ton projet **Council** (pas celui de Cortex).
2. Ajoute ces lignes (le `.env.example` te montre déjà le format) :

   ```
   CORTEX_MCP_URL=https://cortex.mesoutilsagile.com
   CORTEX_MCP_TOKEN=colle-ici-le-MCP_TOKEN-de-cortex
   CORTEX_NOTE_TAGS=council,synthese-ia
   ```

3. Redémarre le backend Council.

> 🔒 Sécurité : ce token reste **uniquement** dans le `.env` du serveur. Il n'est
> jamais envoyé au navigateur. Le bouton appelle ton serveur Council, et c'est lui
> qui parle à Cortex.

Pour retrouver le token de Cortex (sur le VPS) :
```
ssh ubuntu@151.80.232.214 "grep MCP_TOKEN /home/ubuntu/cortex/backend/.env"
```

---

## Fichiers livrés (à remplacer aux mêmes emplacements)

| Fichier | Type | Rôle |
|---|---|---|
| `backend/cortex.js` | **nouveau** | Parle à Cortex + met en forme la note (`pushConversationToCortex`) |
| `backend/config.js` | remplacé | Ajoute `CORTEX_MCP_URL` / `CORTEX_MCP_TOKEN` / `CORTEX_NOTE_TAGS` |
| `backend/server.js` | remplacé | Route `POST /api/conversations/:id/to-cortex` |
| `frontend/src/api.js` | remplacé | Ajoute `api.sendToCortex()` |
| `frontend/src/components/ChatInterface.jsx` | remplacé | Le bouton « 🧠 → Cortex » |
| `.env.example` | remplacé | Documente les 3 nouvelles variables |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.11.0 |
| `CHANGELOG.md` | remplacé | Note de version 2.11.0 |
| *(+ fichiers Recherche v2.10 : `backend/search.js`, `SearchPage.jsx`, `App.jsx`, `Sidebar.jsx`)* | | livrés ensemble pour cohérence |

> **Aucune nouvelle dépendance npm.** On réutilise `fetch` (déjà dans Node), comme ton `test-auth.js`.

---

## Tester en local

1. Mettre la clé dans le `.env` (voir plus haut), redémarrer.
2. Ouvrir une conversation qui a une réponse complète du Council.
3. Cliquer **« 🧠 → Cortex »** sous la réponse.
4. Le bouton affiche **« … envoi »** puis **« ✓ dans Cortex »**.
5. Vérifier dans Cortex : une nouvelle note dans `inbox/`, avec Question / Synthèse / Avis du conseil.

Si ça échoue, le bouton affiche **« ✗ échec »** — dis-le moi avec la capture, le serveur
loggue la raison exacte (souvent : token manquant/incorrect → message « 401 »).

---

## À quoi ressemble la note créée

- **Titre** = le titre de la conversation (ou le début de ta question).
- **Corps** : un résumé en tête, puis `## Question`, `## Synthèse (présidente)`,
  `## Avis du conseil` (un `###` par modèle).
- **Tags** : `council`, `synthese-ia` (modifiables via `CORTEX_NOTE_TAGS`).
- **Emplacement** : `inbox/` de Cortex (comme toute note créée par un outil).

> Pour l'instant la note n'ajoute pas automatiquement de liens `[[...]]` vers tes
> notes existantes (ça demanderait au Council d'interroger Cortex à chaque envoi).
> Tu peux me demander un « passage de rangement » plus tard pour relier ces notes.

---

## Déploiement (VPS) — après validation

1. Pousser les fichiers.
2. Ajouter `CORTEX_MCP_TOKEN` (et les 2 autres variables) dans le `.env` **de production** du Council.
3. **Rebuild du frontend** (nouveau bouton).
4. **Redémarrer** le backend Council (`pm2 restart …`).
5. Pas de changement Nginx (tout passe par `/api` déjà proxifié), pas de migration de données.

---

## Détails techniques (mémo)

- `cortex.js` appelle `<CORTEX_MCP_URL>/mcp` en JSON-RPC : `initialize` puis
  `tools/call` → `kb_create_note` (`{ title, body, tags }`), avec
  `Authorization: Bearer <CORTEX_MCP_TOKEN>`.
- Gère les réponses JSON **et** `text/event-stream` (SSE), et l'éventuel
  `mcp-session-id` (compatible serveur avec ou sans session).
- Erreurs renvoyées proprement : 401 (token), 502 (Cortex injoignable / refus).
