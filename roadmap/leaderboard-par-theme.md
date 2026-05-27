# Leaderboard par thème (data-driven)

**Statut :** 💡 idée validée — à démarrer une fois assez de délibérations accumulées
**Date de capture :** 2026-05-27

## Idée en une phrase

Construire, à partir des **données réelles** produites par l'app, un classement empirique
des modèles **par thème** (droit, code, rédaction, synthèse…), afin de pouvoir — à terme —
**composer dynamiquement le conseil** : convoquer pour chaque question les juges qui se
sont historiquement montrés les meilleurs sur ce type de sujet, plutôt qu'un conseil figé
ou choisi sur des suppositions.

## Pourquoi c'est pertinent ici (et pas du routing « expertise » naïf)

On avait écarté un routeur d'expertise basé sur une carte « tel modèle = bon en X » :
- il n'existe **pas de table fiable** « meilleur modèle par domaine » (les benchmarks
  vieillissent, ne reflètent pas les tâches réelles, les IDs `:free` tournent) ;
- la **diversité** des familles (erreurs décorrélées) est ce qui fait la valeur du conseil ;
  router vers « les 4 spécialistes » risque le *groupthink*.

La version *data-driven* contourne ces deux écueils : on ne suppose rien, **on mesure**.
Chaque délibération produit déjà un classement Stage 2 (`aggregate_rankings`, rang moyen,
plus bas = meilleur). Il suffit de le **persister en l'étiquetant par thème** pour obtenir,
au fil de l'usage, un leaderboard empirique par domaine.

## Conception envisagée

### 1. Classification du thème
À chaque question, produire un thème grossier (ex. : `droit`, `code`, `rédaction`,
`analyse`, `divers`). Options :
- réutiliser le `TITLE_MODEL` (déjà appelé pour le titre) en lui demandant aussi un tag thème ;
- ou un mini-classifieur dédié (1 appel court, peu coûteux).

### 2. Persistance
Accumuler par couple `(thème, modèle)` :
- rang moyen agrégé (moyenne pondérée des `average_rank` reçus),
- nombre d'évaluations,
- taux de victoire (fréquence de la place n°1),
- dernière mise à jour.

Stockage simple d'abord : `data/leaderboard.json` (écriture atomique comme le reste du
storage). Migration possible vers SQLite si le volume grossit.

### 3. Vue « Leaderboard par thème »
Un onglet / une modale qui montre, par thème, le classement des modèles (rang moyen,
nb d'évaluations, win-rate). Lecture seule au début — c'est déjà un outil d'aide à la
décision pour configurer le `.env` ou les presets à la main.

### 4. (À terme) Routeur de conseil
Le routeur compose le conseil en s'appuyant sur ce classement empirique, **sous contraintes** :
- garder **1–2 généralistes** imposés (anti-groupthink) ;
- imposer la **diversité de familles** (pas 4 modèles de la même lignée) ;
- taille de conseil **dynamique** (petite pour une question simple, plus large si dure/ambiguë) ;
- routeur **contraint** (sortie JSON, choix uniquement dans un pool défini) pour qu'il ne
  devienne pas un point de biais unique.

## Garde-fous (rappel)

- **Diversité > expertise pure.** Le leaderboard informe le choix, il ne doit pas écraser
  la décorrélation des erreurs.
- **Significativité statistique** : ne pondérer un thème que lorsqu'il a assez d'évaluations
  (seuil à définir, ex. ≥ 20). En dessous, retomber sur le conseil « Diversité max » par défaut.
- **Transparence** : afficher dans l'UI sur quelles données le routeur s'est appuyé
  (« convoqué pour : droit » + nb d'évaluations).

## Prérequis avant de démarrer

- Avoir **plusieurs dizaines de délibérations** réelles, sinon les données ne veulent rien dire.
- Utiliser en attendant un **conseil fixe et divers** (presets « Diversité max » / `.env`) —
  c'est précisément ce qui alimente la matière du futur leaderboard : plus le conseil est
  divers, plus les classements Stage 2 sont informatifs.

## Étapes de mise en œuvre (ordre suggéré)

1. **Tagging thème** (TITLE_MODEL renvoie aussi un thème) + persistance du tag dans la conversation.
2. **Agrégation** `(thème, modèle)` dans `data/leaderboard.json` à chaque fin de pipeline.
3. **Vue lecture seule** « Leaderboard par thème ».
4. **Routeur** (optionnel, dernière étape) sous les contraintes ci-dessus.

> Aucune dépendance bloquante : les étapes 1–3 apportent déjà de la valeur sans toucher au
> pipeline de délibération. Le routeur (4) ne se branche qu'une fois les données mûres.
