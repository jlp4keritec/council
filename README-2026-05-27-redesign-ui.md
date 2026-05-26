# v2.9.0 — Redesign UI pastel, dispositions Tableau/Lecture, presets, version & À propos

Date : 2026-05-27

## Contenu de la release
- Refonte visuelle pastel (bleu / blanc / rouge) via les variables CSS `:root`.
- Deux dispositions commutables et persistées (Tableau / Lecture).
- Stage 2 en liste rangée (rang moyen réel `aggregate_rankings`).
- 3 conseils prédéfinis dans le modal Configuration + bouton « Défaut (.env serveur) ».
- Version affichée dans la sidebar (clic → modale « À propos » qui lit `CHANGELOG.md`).

## Fichiers de cette livraison (à écraser / ajouter)
- `CHANGELOG.md` ............................ nouveau, à la racine (Keep a Changelog).
- `package.json` ........................... version → 2.9.0 (racine, backend).
- `frontend/package.json` .................. version → 2.9.0 (source de `__APP_VERSION__`).
- `frontend/vite.config.js` ................ injecte `__APP_VERSION__` + autorise l'import `?raw` du CHANGELOG racine.
- `frontend/src/App.jsx` ................... câble la modale « À propos ».
- `frontend/src/components/Sidebar.jsx` .... badge version cliquable en pied de sidebar.
- `frontend/src/components/About.jsx` ...... nouveau, modale « À propos » (lit `CHANGELOG.md`).

> À appliquer EN PLUS des 6 fichiers du redesign (`council-redesign-pastel.zip`) et de `ModelSelector.jsx`, déjà livrés.

## Build / deploy
Aucune nouvelle dépendance. `cd frontend && npm run build` (vérifié : 294 modules, 0 erreur), puis déploiement habituel (`.\deploy-council.ps1`, sans `-SkipBuild`).

## Versioning (entretien)
- Garder une section `## [Unreleased]` en tête de `CHANGELOG.md` ; y ajouter chaque feature dans le même commit que le code.
- À la release : renommer `[Unreleased]` en `[X.Y.Z] - AAAA-MM-JJ`, recréer un `[Unreleased]` vide, ajuster les liens de comparaison (`<org>/<repo>`).
