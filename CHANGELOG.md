# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.
Le format est basé sur [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/),
et ce projet adhère au [versionnage sémantique](https://semver.org/lang/fr/).

---

## [Unreleased]

### Added

### Changed

### Fixed

### Removed

---

## [2.9.1] - 2026-05-27

### Fixed
- Suppression de conversation : le `DELETE /api/conversations/:id` n'envoie plus d'en-tête `Content-Type: application/json` quand la requête n'a pas de corps. Corrige le 400 `FST_ERR_CTP_EMPTY_JSON_BODY` (« Body cannot be empty when content-type is set to 'application/json' ») qui empêchait la suppression. Le helper `jsonRequest` (`frontend/src/api.js`) n'ajoute désormais ce header que lorsqu'un corps est présent.

---

## [2.9.0] - 2026-05-27

### Added
- Deux dispositions d'affichage commutables et persistées (clé localStorage `council-view`) : **Tableau** (3 panneaux côte à côte : Conseil / Classement / Synthèse) et **Lecture** (panneaux empilés en colonne centrée). Toggle dans l'en-tête de la zone principale, masqué sous 1180 px (empilement automatique).
- Stage 2 affiché en **liste rangée** construite sur le rang moyen réel (`aggregate_rankings`, plus bas = meilleur) ; détail par évaluateur (forces / faiblesses) conservé dans un repli.
- 3 **conseils prédéfinis** dans le modal Configuration (Diversité max / Raisonnement / Conseil actuel), familles d'entraînement décorrélées, + bouton « Défaut (.env serveur) ».
- Affichage de la **version** dans la sidebar + modale **« À propos »** lisant ce CHANGELOG.

### Changed
- Refonte visuelle complète : thème pastel **bleu / blanc / rouge** appliqué via les variables CSS `:root` (retinte automatique de la sidebar, des modales et du login), dé-verdissement complet.
- Polices : Bricolage Grotesque (titres), Hanken Grotesk (texte), Geist Mono (métriques).
- Barre de métriques (temps des 3 stages + total + tokens + coût) repositionnée en pleine largeur sous le board, par réponse.

### Notes
- Aucune nouvelle dépendance npm. Le `.env` (modèles du conseil) n'est pas modifié par cette release.

---

## [2.8.0] - 2026-05-17

### Added
- Authentification mono-utilisateur (login `admin` / `OPENROUTER_API_KEY`, cookie signé HMAC).
- Page d'atterrissage publique.

---

## [2.7.1] - 2026-05-17

### Added
- Quota quotidien dynamique avec détection du mode OpenRouter (free sans crédit / free avec crédit / payant) et bouton de rafraîchissement du statut.

---

<!-- Liens de comparaison (ajuste <org>/<repo> a ton depot GitHub) -->
[Unreleased]: https://github.com/<org>/llm-council/compare/v2.9.1...HEAD
[2.9.1]: https://github.com/<org>/llm-council/compare/v2.9.0...v2.9.1
[2.9.0]: https://github.com/<org>/llm-council/compare/v2.8.0...v2.9.0
[2.8.0]: https://github.com/<org>/llm-council/compare/v2.7.1...v2.8.0
[2.7.1]: https://github.com/<org>/llm-council/releases/tag/v2.7.1
