# README — 2026-05-28 — Recherche dans l'historique

**Fonction principale : `searchConversations`** (backend) + page **`SearchPage`** (frontend)
**Version : v2.10.0**

---

## En 2 phrases

Un bouton **« 🔍 Recherche »** apparaît dans la barre de gauche. Il ouvre une page
qui fouille dans **toutes** tes conversations (même au-delà des 20 affichées) et
retrouve le mot que tu tapes dans : tes questions, les réponses des IA du conseil
et les synthèses de la présidente — avec le mot **surligné** dans un extrait.

---

## Comment l'installer (remplacement de fichiers)

Dézippe l'archive et **remplace** les fichiers existants par ceux du ZIP (mêmes
emplacements). Liste des fichiers livrés :

| Fichier | Type | Rôle |
|---|---|---|
| `backend/search.js` | **nouveau** | Le moteur de recherche (`searchConversations`) |
| `backend/server.js` | remplacé | Ajoute la route `GET /api/search?q=` |
| `frontend/src/api.js` | remplacé | Ajoute `api.searchConversations()` |
| `frontend/src/components/SearchPage.jsx` | **nouveau** | La page de recherche |
| `frontend/src/App.jsx` | remplacé | Branche la page + le bouton |
| `frontend/src/components/Sidebar.jsx` | remplacé | Ajoute le bouton « 🔍 Recherche » |
| `package.json` | remplacé | Version → 2.10.0 |
| `frontend/package.json` | remplacé | Version → 2.10.0 |
| `CHANGELOG.md` | remplacé | Note de version 2.10.0 |

> Aucune nouvelle dépendance à installer. Pas de changement Nginx (la route `/api`
> est déjà proxifiée).

---

## Tester en local

1. Démarrer comme d'habitude (`start.bat` / `start.ps1` / `start.sh`).
2. Se connecter, cliquer sur **« 🔍 Recherche »** en bas à gauche.
3. Taper un mot présent dans une vieille conversation.
4. Vérifier : la liste apparaît, le mot est surligné, et cliquer sur un résultat
   ouvre la bonne conversation.

---

## Déploiement (VPS)

Après validation locale :

1. Pousser les fichiers.
2. **Rebuild du frontend** (le bouton + la page sont côté React).
3. **Redémarrer le backend** Fastify (nouvelle route `/api/search`).

Pas de migration de données : la recherche lit les fichiers JSON existants tels quels.

---

## Détails techniques (pour mémoire)

- `searchConversations(query)` lit toutes les conversations via `storage.listConversations()`
  puis `storage.getConversation(id)`, et cherche dans `title`, les messages `user`,
  `stage1[].response` et `stage3.response`.
- Matching **insensible casse + accents** via un « folding » (NFD + suppression des
  diacritiques) avec une table de correspondance d'index, pour pouvoir surligner
  le mot à la bonne position dans le texte d'origine.
- Limites de sécurité : 100 conversations max renvoyées, 4 extraits max par
  conversation (évite les réponses énormes).
- La route renvoie `{ query, results: [{ id, title, created_at, match_count, snippets:[{ where, text, matchStart, matchEnd }] }] }`.
