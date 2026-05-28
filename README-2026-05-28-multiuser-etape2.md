# README — 2026-05-28 — Multi-utilisateur · Étape 2 (clé OpenRouter par utilisateur)

**Fonctions principales :**
- `setOpenRouterKey`, `getDecryptedKey` (backend `users.js`)
- `encryptSecret`, `decryptSecret` (backend `crypto.js`)
- `resolveApiKey` (backend `server.js`)

**Version : v2.15.0**

---

## 🎉 Ce qui change

À partir de cette version, **chaque utilisateur branche sa propre clé OpenRouter**.

- Sans clé → bandeau permanent dans le chat : *« Pour utiliser le Council, ajoute ta clé… »* + bouton pour aller à Mon compte. **Aucune délibération possible.**
- Avec clé → toutes les délibérations utilisent **sa** clé, sa consommation, son crédit.
- **Toi en admin** : si tu ne mets pas de clé personnelle, l'appli retombe automatiquement sur `OPENROUTER_API_KEY` du `.env` (filet de sécurité pour les tests).

> 🚀 **C'est ça qui débloque la mise en public.** Une fois cette étape validée, tu peux ouvrir le site à n'importe qui sans risque pour ton crédit.

---

## ⚠️ Réglage obligatoire avant test

Dans ton `.env`, ajoute cette ligne :

```
OPENROUTER_KEYS_SECRET=une-longue-chaine-aleatoire-stable-que-tu-gardes
```

> 🔒 **Pourquoi ?** C'est la clé maître qui chiffre les clés OpenRouter de tes utilisateurs. Si tu changes cette valeur après coup, toutes les clés enregistrées deviennent illisibles (les utilisateurs devront re-coller la leur). **Mets une valeur et garde-la pour toujours.**
> Si tu laisses vide, le système se rabat sur `OPENROUTER_API_KEY` — ça marche en local mais c'est fragile.

Exemple de génération rapide d'une bonne valeur (Windows PowerShell) :
```
[Convert]::ToBase64String((1..32 | % { Get-Random -Maximum 256 }))
```

---

## Fichiers livrés

| Fichier | Type | Rôle |
|---|---|---|
| `backend/crypto.js` | **nouveau** | Chiffrement AES-256-GCM (zéro dépendance) |
| `backend/users.js` | remplacé | + set/clear/get clé OpenRouter |
| `backend/auth.js` | remplacé | + routes `PUT/DELETE/test /api/auth/openrouter-key` |
| `backend/config.js` | remplacé | + variable `OPENROUTER_KEYS_SECRET` |
| `backend/openrouter.js` | remplacé | `queryModel`/`pingModel` acceptent `apiKey` en option |
| `backend/council.js` | remplacé | propage `override.apiKey` partout |
| `backend/server.js` | remplacé | `resolveApiKey` + injection + blocage strict |
| `frontend/src/components/AccountPage.jsx` | remplacé | + bloc **« 🔑 Ma clé OpenRouter »** (Enregistrer, Tester, Supprimer) |
| `frontend/src/components/ChatInterface.jsx` | remplacé | Bandeau « ajoute ta clé » quand pas de clé |
| `frontend/src/App.jsx` | remplacé | Propage `hasKey` + sync `has_key` en temps réel |
| `frontend/src/api.js` | remplacé | + `authSetOpenRouterKey`, `authClearOpenRouterKey`, `authTestOpenRouterKey` |
| `.env.example` | remplacé | Documente `OPENROUTER_KEYS_SECRET` |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.15.0 |
| `CHANGELOG.md` | remplacé | Note 2.15.0 |

> **Aucune nouvelle dépendance npm.** Chiffrement via le module intégré `node:crypto` (AES-256-GCM).

---

## Tester en local

1. Mets `OPENROUTER_KEYS_SECRET=...` dans le `.env`, redémarre le backend, recharge la page (Ctrl+Shift+R).
2. Connecte-toi sur **toto@test.com** (ton compte admin actuel).
3. Va dans **Mon compte** → nouvelle section **« 🔑 Ma clé OpenRouter »**.
4. Colle ta vraie clé (commence par `sk-or-…`) → clic **« 🔎 Tester ma clé »** → vérifie le « Clé valide ✓ ».
5. Clic **« Enregistrer la clé »** → badge passe à **« ✓ Clé enregistrée »**.
6. Lance une délibération depuis une conversation — elle doit marcher comme avant, **mais via TA clé**.

**Test du mode strict :**

7. Déconnexion → crée un 2e compte `alice@test.fr`.
8. Va sur l'écran d'accueil et essaie de lancer une question → **bandeau orange** « Ajoute ta clé OpenRouter ».
9. Clic « Aller à Mon compte » → ajoute une clé (peux mettre une fausse pour voir le test échouer).
10. Si tu mets une vraie clé pour Alice, elle peut lancer ses délibérations, **sans toucher au crédit de toto**.

---

## Sous le capot (mémo)

- **Algo de chiffrement** : AES-256-GCM, IV aléatoire à chaque opération, clé maître dérivée par `scrypt(secret, salt)`.
- **Stockage** : champ `openrouter_key_enc` du `users.json`, format `v1.<iv>.<tag>.<ciphertext>` en base64url.
- **API jamais expose la clé** : `/me` et les autres endpoints ne renvoient que `has_key: true|false`.
- **Test de clé** : appel `GET /api/v1/key` côté OpenRouter (renvoie l'info de quota, sans consommer de crédit).
- **Propagation** : la clé est lue, déchiffrée juste avant l'appel OpenRouter, passée via `options.apiKey` dans `queryModel`. Jamais loggée.
- **Suppression de compte** : la clé chiffrée disparaît avec le user (déjà géré par v2.14).

---

## Et après ?

**Étape 3 — Panneau Admin** : lister tous les utilisateurs, réinitialiser un mot de passe oublié, désactiver/réactiver, supprimer un compte, voir les stats par utilisateur (nb conversations, dernière connexion, etc.). Tu valides l'Étape 2 et on enchaîne.
