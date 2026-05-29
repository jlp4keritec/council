# README — Synthèse Président lisible même si JSON cassé (v2.16.4)

**Date :** 29 mai 2026
**Version :** 2.16.4
**Type :** correctif (fix)

---

## But

Empêcher l'affichage du **JSON brut** dans la synthèse du Président, et corriger
les retours à la ligne qui restaient affichés en `\n` littéraux.

## Cause

Le Président renvoie sa réponse en JSON (`{analysis, final_answer}`). Le backend
doit ouvrir ce JSON et n'afficher que `final_answer`. Mais les modèles gratuits
(ex. `gpt-oss-20b:free`) produisent souvent un JSON **cassé ou tronqué** que
`JSON.parse` refuse. L'ancien filet de secours affichait alors **tout le texte
brut**, avec les `\n` non interprétés.

## Fonction modifiée

| Fichier | Fonction | Changement |
|---|---|---|
| `backend/council.js` | `parseChairmanResponse(text)` | 2 filets de sécurité ajoutés. |

Nouvelles fonctions internes : `jsonUnescape(s)` et `extractFinalAnswerLoose(text)`.

## Les 4 niveaux de secours (du plus propre au plus dégradé)

1. **JSON direct** — `JSON.parse` réussit → on prend `final_answer`. (inchangé)
2. **JSON dans un bloc markdown** — extraction du fence ```json. (inchangé)
3. **Extraction tolérante** *(nouveau)* — si le JSON est cassé mais contient bien
   un champ `final_answer`, on récupère sa valeur « à la main » (gestion des
   guillemets échappés) puis on la dé-échappe (`\n` → vrais retours à la ligne).
4. **Dernier recours** *(amélioré)* — si rien n'est récupérable, on garde tout le
   texte, mais on convertit les `\n` littéraux en vrais retours à la ligne pour
   que ce soit au moins lisible.

Le champ `parse_method` indique lequel a été utilisé : `json` | `loose_extract`
| `fallback_text` | `analysis_disabled` | `empty`. Utile pour le debug.

## Effet

- Le Président affiche toujours une réponse propre, même avec un modèle gratuit
  capricieux.
- Plus de `\n` affichés tels quels.

## Fichier à remplacer

- `backend/council.js`
