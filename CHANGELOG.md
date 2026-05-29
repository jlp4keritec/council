# CHANGELOG — extrait à coller en haut de CHANGELOG.md

## [2.17.0] - 2026-05-29

### Added
- **Cortex configurable par utilisateur** : nouveau bloc « 🧠 Mon Cortex » dans
  Mon compte (URL + token). Le token est chiffré côté serveur (AES-256-GCM),
  jamais renvoyé au navigateur. Bouton « Tester » (handshake MCP).
  Plus besoin de toucher au `.env` : chaque utilisateur branche son propre Cortex.
- Routes `GET/PUT/DELETE /api/auth/cortex-config` + `POST /api/auth/cortex-config/test`.
- `users.js` : `setCortexConfig`, `clearCortexConfig`, `getCortexConfig`.
- `cortex.js` : `testCortexConnection`, et override `{url, token}` par appel.
- `server.js` : `resolveCortexConfig` (config user, filet `.env` pour admin).

### Changed
- `/api/auth/me` renvoie aussi `has_cortex` et `cortex_url`.
- La route `to-cortex` utilise la config Cortex de l'utilisateur connecté.

### Note
- `server.js` conserve le fix v2.16.3 (titre stocké en texte).
