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

## [2.16.0] - 2026-05-28

### Added
- **Panneau Administrateur (Étape 3 multi-user, dernière étape).** Nouveau bouton **« 🛡️ Admin »** dans la barre de gauche, **visible uniquement pour les admins**. La page affiche les stats globales (utilisateurs, admins, comptes avec clé OpenRouter, conversations, coût cumulé) et un tableau de **tous les comptes** avec : email, rôle, état actif/désactivé, présence d'une clé, date de création, nb de conversations, **coût cumulé**, et **dernière activité**.
  - Actions par compte : **Reset mot de passe** (mot de passe temporaire affiché une fois, avec bouton « Copier »), **Désactiver/Réactiver** (un compte désactivé ne peut plus se connecter ni utiliser l'API, son cookie est révoqué automatiquement), **Promouvoir/Rétrograder admin**, **Supprimer définitivement** (compte + ses conversations).
  - Tu ne peux pas te désactiver, te rétrograder ni te supprimer toi-même (sécurité anti-lockout).
  - Toutes les routes `/api/admin/*` sont protégées par un check `is_admin` (403 sinon). Tracé dans les logs serveur.
  - Backend : `users.js` (+ `listAllUsers`, `setActive`, `setAdmin`, `adminResetPassword`, `adminDelete`) ; `auth.js` (préHandler bloque les comptes désactivés, login pareil) ; `server.js` (5 routes admin + `computeUserStats` qui calcule conv_count, total_cost_usd, last_active_at).
  - Frontend : nouveau `AdminPage.jsx` (tableau + filtre par email + modale mot de passe temporaire) ; `App.jsx` + `Sidebar.jsx` (bouton conditionnel) ; `api.js` (+ 5 méthodes admin) ; gestion `403 account_disabled` qui kick l'utilisateur sur Login.

---

## [2.15.0] - 2026-05-28

### Added
- **Étape 2 multi-user : clé OpenRouter par utilisateur (mode strict).** Chaque compte stocke désormais **sa propre clé OpenRouter**, **chiffrée** côté serveur (AES-256-GCM, clé maître dérivée par scrypt depuis `OPENROUTER_KEYS_SECRET`). Sans clé personnelle, l'utilisateur ne peut pas lancer de délibération (403 `no_api_key` + bandeau d'invitation à ouvrir « Mon compte »). **L'administrateur** garde un filet de sécurité : sa clé personnelle, sinon repli sur `OPENROUTER_API_KEY` du `.env`.
  - Backend : nouveau `backend/crypto.js` (encrypt/decrypt sans dépendance externe) ; `backend/users.js` (+ `setOpenRouterKey`, `clearOpenRouterKey`, `getDecryptedKey`) ; `backend/openrouter.js` (`queryModel` / `queryModelsParallel` / `pingModel` acceptent `options.apiKey`) ; `backend/council.js` propage `override.apiKey` jusqu'aux appels ; `backend/server.js` (`resolveApiKey` + injection dans l'override + blocage strict) ; `backend/auth.js` (+ routes `PUT /api/auth/openrouter-key`, `DELETE /api/auth/openrouter-key`, `POST /api/auth/openrouter-key/test`) ; nouvelle variable `OPENROUTER_KEYS_SECRET` dans `config.js`.
  - Frontend : nouveau bloc « 🔑 Ma clé OpenRouter » dans `AccountPage.jsx` (Enregistrer, **Tester ma clé** via `/api/v1/key` OpenRouter, Supprimer, badge « clé enregistrée / aucune clé ») ; `ChatInterface.jsx` affiche un bandeau permanent quand `has_key=false`, avec bouton « Aller à Mon compte » ; `App.jsx` synchronise `authMe.has_key` en temps réel ; `api.js` (+ `authSetOpenRouterKey`, `authClearOpenRouterKey`, `authTestOpenRouterKey`).
  - Clé jamais exposée au navigateur (l'API renvoie uniquement `has_key: true|false`). Suppression de compte = suppression de la clé.

---

## [2.14.0] - 2026-05-28

### Added
- **Page « Mon compte »** : un nouveau bouton « 👤 Mon compte » en bas à gauche (et un clic sur ton email) ouvre une page intégrée permettant de **changer son mot de passe**, **changer son email** et **supprimer son compte** (avec confirmation « SUPPRIMER » + double confirmation). Chaque action sensible redemande le **mot de passe actuel**. La suppression supprime aussi toutes les conversations de l'utilisateur (ses propres, pas les legacy).
  - Backend : `backend/users.js` (+ `updatePassword`, `updateEmail`, `deleteUser`) ; `backend/auth.js` (+ routes `PATCH /api/auth/password`, `PATCH /api/auth/email`, `DELETE /api/auth/account` ; `/me` renvoie `created_at`).
  - Frontend : `frontend/src/components/AccountPage.jsx` (nouveau) ; `App.jsx` (branchement + nouveau state `authMe`) ; `Sidebar.jsx` (bouton + email cliquable) ; `api.js` (`authChangePassword`, `authChangeEmail`, `authDeleteAccount`).

---

## [2.13.0] - 2026-05-28

### Changed
- **Recherche : page intégrée (fini la fenêtre pop-up).** La recherche s'affiche désormais dans la zone centrale, à la place de la conversation. On en sort via « ← Retour », en cliquant une conversation, ou via « + Nouvelle ».

### Added
- **Filtres de recherche** (toujours visibles en haut) : **période** (du / au), **juge** (modèle du conseil) et **président** (modèle de synthèse). Le **mot-clé devient optionnel** : on peut chercher uniquement par filtres (ex. tout ce qu'un juge a dit en mai). Les menus juge/président se remplissent automatiquement avec les modèles présents dans l'historique. Backend : `search.js` réécrit (`searchConversations(criteria, user)` + `getSearchFacets(user)`), routes `GET /api/search` (paramètres `q,date_from,date_to,judge,chairman`) et `GET /api/search/facets`. Frontend : `SearchPage.jsx` transformé en page intégrée, câblage dans `App.jsx`, `api.searchConversations(criteria)` + `api.getSearchFacets()`.

---

## [2.12.0] - 2026-05-28

### Added
- **Multi-utilisateur — Étape 1 (comptes + isolation).** Le site devient ouvert : inscription libre par **email + mot de passe** (onglet « Créer un compte » sur la page de connexion) et **connexion par email**. Chaque utilisateur ne voit désormais **que ses propres conversations** (recherche incluse). Le **1er inscrit devient administrateur** et hérite des conversations existantes (sans propriétaire). Mots de passe hachés avec **scrypt** (intégré à Node, aucune dépendance ajoutée), petit garde anti-bruteforce par IP.
  - Backend : nouveau `backend/users.js` (magasin `data/users.json`, hachage scrypt) ; `backend/auth.js` réécrit (signup/login/logout/me, session par `uid`) ; `backend/storage.js` rendu multi-user (champ `owner`, `userCanAccess`) ; routes de `server.js` scopées par utilisateur ; `backend/search.js` scopé ; nouvelles variables `SESSION_SECRET`, `PASSWORD_MIN_LENGTH`, `USERS_FILE`.
  - Frontend : `Login.jsx` avec onglets Connexion/Inscription ; `api.authSignup` ; connexion par email.
  - ⚠️ Transitoire : tant que l'Étape 2 n'est pas faite, **tous les comptes partagent la clé OpenRouter du serveur**. À NE PAS déployer en public avant l'Étape 2 (clé par utilisateur).

---

## [2.11.0] - 2026-05-28

### Added
- **Envoi vers Cortex** : nouveau bouton « 🧠 → Cortex » à côté des boutons d'export. Il envoie la délibération complète (question + avis du conseil + synthèse de la présidente) sous forme de note Markdown dans Cortex (second cerveau), où elle arrive dans `inbox/`. Note mise en forme selon les conventions Cortex (résumé en tête, sections, 2 tags par défaut). Backend : `backend/cortex.js` (`pushConversationToCortex`, client MCP via token Bearer statique, **sans nouvelle dépendance**) + route `POST /api/conversations/:id/to-cortex`. Frontend : `api.sendToCortex` + bouton dans `ChatInterface.jsx`. Config : `CORTEX_MCP_URL`, `CORTEX_MCP_TOKEN`, `CORTEX_NOTE_TAGS` (le token reste côté serveur, jamais exposé au navigateur).

---

## [2.10.0] - 2026-05-28

### Added
- **Recherche dans l'historique** : nouvelle page dédiée (bouton « 🔍 Recherche » dans la barre latérale) permettant de retrouver n'importe quelle conversation, y compris au-delà des 20 affichées. La recherche balaie les titres, les questions de l'utilisateur, les réponses du conseil (stage1) et les synthèses de la présidente (stage3). Insensible à la casse et aux accents, avec surlignage du mot trouvé dans des extraits contextuels. Backend : `backend/search.js` (`searchConversations`) + route `GET /api/search?q=`. Frontend : `frontend/src/components/SearchPage.jsx`, `api.searchConversations`, câblage dans `App.jsx` et bouton dans `Sidebar.jsx`.

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
