# Council — redesign pastel (bleu / blanc / rouge) + 2 dispositions

Remplace ces 6 fichiers dans ton projet (mêmes chemins), puis rebuild le front
(`cd frontend && npm run build`). Aucune dépendance nouvelle.

## Fichiers fournis (à écraser tels quels)
- frontend/index.html ................ ajoute les polices Google (Bricolage Grotesque, Hanken Grotesk, Geist Mono)
- frontend/src/index.css ............. thème pastel (retinté via :root) + dispositions Tableau/Lecture + panneaux/liste rangée
- frontend/src/components/ChatInterface.jsx . en-tête avec toggle Lecture/Tableau (persisté), board par réponse, barre de métriques
- frontend/src/components/Stage1.jsx . panneau « Avis » (onglets par modèle)
- frontend/src/components/Stage2.jsx . panneau « Classement » en liste rangée (depuis aggregate_rankings) + détail par évaluateur replié
- frontend/src/components/Stage3.jsx . panneau « Synthèse » (onglets Synthèse / Analyse du Chairman)

## NON modifiés (laissés tels quels)
App.jsx, Sidebar.jsx, ModelSelector.jsx, QuotaHelp.jsx, Login.jsx/.css, api.js, utils.js, main.jsx.
La sidebar, les modales et le login se retintent automatiquement (le CSS utilise déjà les variables :root).

## Deux dispositions (un seul thème)
- Tableau : 3 panneaux côte à côte (Conseil | Classement 264px | Synthèse), par réponse.
- Lecture : panneaux empilés dans une colonne centrée (~900px).
- Toggle en haut à droite, mémorisé par navigateur (localStorage `council-view`).
- Sous 1180px : bascule auto en empilé, toggle masqué.

## Adaptations vs maquette
1. Multi-tours : chaque réponse = son propre board ; les tours s'empilent ; la page défile.
2. Stage 2 : liste rangée construite sur le RANG MOYEN réel (aggregate_rankings, plus bas = meilleur),
   pas de score /10 inventé ; le détail par évaluateur (forces/faiblesses) reste accessible dans un repli.
3. Metrics : barre pleine largeur sous le board (temps des 3 stages + total + tokens + coût).

Vérifié : `npm run build` (Vite 7) compile sans erreur — 292 modules.
