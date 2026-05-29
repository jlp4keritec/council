# CHANGELOG — extrait à coller en haut de CHANGELOG.md

## [2.16.4] - 2026-05-29

### Fixed
- **Synthèse du Président affichée en JSON brut** : quand le modèle de synthèse
  (souvent un `:free`) renvoyait un JSON cassé/tronqué, `JSON.parse` échouait et
  l'ancien fallback affichait tout le texte brut avec les `\n` non interprétés.
  `parseChairmanResponse` a maintenant 2 filets supplémentaires :
  extraction tolérante du champ `final_answer` (JSON cassé), et conversion des
  `\n` littéraux en vrais retours à la ligne en dernier recours.

### Added
- `jsonUnescape()` et `extractFinalAnswerLoose()` (helpers internes `council.js`).
- Nouveau `parse_method` possible : `loose_extract`.
