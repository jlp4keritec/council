# README — 2026-05-28 — Multi-utilisateur · Étape 1 (comptes)

**Fonctions principales : `createUser` / `authenticate`** (backend `users.js`) + auth multi-user
**Version : v2.12.0**

> Ceci est l'**Étape 1 sur 3** du chantier multi-utilisateur :
> 1. ✅ **Les comptes** (cette livraison) — inscription/connexion + chacun ses conversations.
> 2. ⏭️ La clé OpenRouter par utilisateur (chacun branche la sienne).
> 3. ⏭️ Le quota par personne.

---

## En 2 phrases

Le site devient ouvert : n'importe qui crée un compte (email + mot de passe) et ne
voit **que ses propres conversations**. La **première personne qui s'inscrit devient
admin** et récupère automatiquement tes 3 conversations actuelles.

---

## ⚠️ Très important (à lire avant de tester)

À cette étape, **tous les comptes partagent encore TA clé OpenRouter** (celle du
`.env`). La « clé par utilisateur » arrive à l'Étape 2.

👉 Donc : **teste en local seulement. Ne mets pas ce site en accès public entre
l'Étape 1 et l'Étape 2** — sinon les comptes des autres consommeraient ton crédit.

---

## Fichiers livrés (à remplacer / ajouter)

| Fichier | Type | Rôle |
|---|---|---|
| `backend/users.js` | **nouveau** | Comptes + mots de passe (scrypt) |
| `backend/auth.js` | remplacé | Inscription / connexion par email, sessions par utilisateur |
| `backend/storage.js` | remplacé | Chaque conversation a un propriétaire ; isolation |
| `backend/server.js` | remplacé | Toutes les routes filtrées par utilisateur |
| `backend/search.js` | remplacé | Recherche limitée à ses conversations |
| `backend/config.js` | remplacé | Nouvelles variables `SESSION_SECRET`, `PASSWORD_MIN_LENGTH`, `USERS_FILE` |
| `frontend/src/components/Login.jsx` | remplacé | Onglets « Connexion » / « Créer un compte » |
| `frontend/src/api.js` | remplacé | Ajoute `authSignup`, connexion par email |
| `.env.example` | remplacé | Documente les nouvelles variables |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.12.0 |
| `CHANGELOG.md` | remplacé | Note de version 2.12.0 |
| *(+ tout ce qui précède : Recherche v2.10 et Cortex v2.11)* | | livré ensemble, cumulatif |

> **Aucune nouvelle dépendance npm.** Mots de passe et sessions utilisent le
> chiffrement **intégré à Node**.

---

## Tester en local (5 min)

1. Remplace les fichiers, redémarre le backend.
2. Ouvre le site : tu arrives sur la page de connexion.
3. Clique **« Créer un compte »**, inscris-toi avec **ton** email + un mot de passe (8 caractères mini).
   - Comme tu es le **premier**, tu deviens **admin** → tu dois voir tes 3 anciennes conversations.
4. Déconnecte-toi (bouton en bas à gauche).
5. **Crée un 2e compte** (autre email) → tu ne dois voir **aucune** conversation (normal, c'est un autre utilisateur).
6. Reconnecte-toi avec le 1er compte → tes conversations sont toujours là.

✅ Si chaque compte ne voit que ses propres conversations, l'Étape 1 est validée.

---

## Réglage optionnel (recommandé avant l'Étape 2)

Dans ton `.env`, ajoute une valeur fixe pour `SESSION_SECRET` (une longue chaîne
aléatoire de ton choix). Ça garde les gens connectés même si la clé partagée change.
Si tu ne le fais pas, ça marche quand même (valeur dérivée par défaut).

---

## Ce qui se passe sous le capot (mémo)

- Les comptes sont dans `data/users.json` (mots de passe **hachés**, jamais en clair).
- Chaque conversation gagne un champ `owner` = l'id de son créateur.
- Une conversation sans `owner` (créée avant) = « héritée » → visible par l'**admin** uniquement.
- Le serveur renvoie **404** si tu tentes d'accéder à une conversation qui n'est pas à toi
  (on ne révèle même pas qu'elle existe).

---

## Et après ?

Quand tu valides l'Étape 1, on enchaîne sur l'**Étape 2** : chaque utilisateur colle
**sa** clé OpenRouter (stockée chiffrée), et l'appli l'utilise pour ses appels. C'est
là que « chacun son crédit » deviendra réel.
