# README — 2026-05-28 — Recherche v2 (page intégrée + filtres)

**Fonctions principales : `searchConversations` + `getSearchFacets`** (backend `search.js`)
**Page : `SearchPage`** (désormais intégrée, plus de pop-up)
**Version : v2.13.0**

---

## En 2 phrases

La recherche n'est plus une fenêtre par-dessus : elle s'affiche **dans la page**, à la
place de la conversation. En haut, des **filtres toujours visibles** : période (du/au),
**juge** et **président**. Le **mot-clé est optionnel** — tu peux chercher rien qu'avec
les filtres.

---

## Ce qui change pour toi

- Clique **« 🔍 Recherche »** (en bas à gauche) → la recherche prend la zone centrale.
- En haut : un champ mot-clé (optionnel) + **Du / Au** + **Juge** + **Président** + **Réinitialiser**.
- Les menus **Juge** et **Président** listent automatiquement les modèles présents
  dans ton historique (tu choisis, tu ne tapes rien).
- Un résultat → clic → la conversation s'ouvre (et la recherche se referme).
- Pour sortir : **« ← Retour »**, cliquer une conversation, ou **« + Nouvelle »**.

Exemples possibles : « tout ce que le juge *gpt-4o* a dit » · « mes délibérations
entre le 1er et le 15 mai » · « *calendrier* + président *claude* ».

---

## Fichiers livrés (à remplacer aux mêmes emplacements)

| Fichier | Type | Rôle |
|---|---|---|
| `backend/search.js` | remplacé | Recherche filtrée + liste des juges/présidents |
| `backend/server.js` | remplacé | `GET /api/search` (filtres) + `GET /api/search/facets` |
| `frontend/src/components/SearchPage.jsx` | remplacé | Page intégrée + filtres en haut |
| `frontend/src/App.jsx` | remplacé | Affiche la recherche dans la zone centrale |
| `frontend/src/api.js` | remplacé | `searchConversations(criteria)` + `getSearchFacets()` |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.13.0 |
| `CHANGELOG.md` | remplacé | Note de version 2.13.0 |
| *(+ tout le cumul précédent : Cortex v2.11, comptes v2.12)* | | livré ensemble |

> **Aucune nouvelle dépendance.** Testé : mot-clé seul, période, juge, président,
> combinaisons, et surlignage du mot trouvé. ✅

---

## Tester en local

1. Remplace les fichiers, redémarre le backend, recharge la page.
2. Clique **« 🔍 Recherche »** : tu dois voir la page **dans la zone centrale** (pas de pop-up).
3. Tape un mot → résultats surlignés.
4. Vide le mot-clé, choisis un **Juge** dans le menu → tu vois toutes les délibérations
   où ce modèle a donné un avis.
5. Mets une **période** (Du/Au) → la liste se réduit à cette plage.
6. Clique un résultat → la bonne conversation s'ouvre.

---

## Note (multi-utilisateur)

La recherche reste **limitée à tes propres conversations** (l'isolation de l'Étape 1
est respectée). Rappel : on est toujours en pause sur l'Étape 2 (clé par utilisateur),
donc **local seulement** pour l'instant.
