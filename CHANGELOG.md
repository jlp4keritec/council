# CHANGELOG — extrait à coller en haut de CHANGELOG.md

## [2.16.3] - 2026-05-29

### Fixed
- **Titre de conversation stocké comme objet** : `server.js` passait l'objet entier
  `{title, theme}` renvoyé par `generateConversationTitle` à `updateConversationTitle`,
  au lieu du seul texte. Cause racine du crash React error #31 sur la sidebar.
  Corrigé aux deux endroits (mode normal + mode streaming SSE).

### Changed
- `storage.js` : `updateConversationTitle(id, title, theme)` accepte désormais un `theme`
  optionnel et **blinde** l'écriture : le titre est toujours persisté en texte, et un objet
  reçu par erreur est décortiqué. Le `theme` est rangé dans `conv.theme` (champ séparé).
