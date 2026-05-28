# README — 2026-05-28 — Page « Mon compte »

**Fonctions principales :**
- `updatePassword`, `updateEmail`, `deleteUser` (backend `users.js`)
- Page **`AccountPage.jsx`** (frontend)

**Version : v2.14.0**

---

## En 2 phrases

Tu peux maintenant **changer ton mot de passe**, **changer ton email** et **supprimer
ton compte** depuis une page « Mon compte » intégrée. Chaque action sensible
**redemande ton mot de passe actuel** (règle de sécurité non négociable).

---

## Ce qui change pour toi

- En bas à gauche, un **bouton « 👤 Mon compte »** apparaît entre Recherche et Configuration.
- Tu peux aussi cliquer **sur ton email** (à côté de Déconnexion) — même page.
- La page s'affiche dans la zone centrale (pas de pop-up), avec 4 blocs :
  1. **Informations** (email, rôle admin/utilisateur, date de création).
  2. **Changer le mot de passe** (actuel + nouveau + confirmation).
  3. **Changer l'email** (nouvel email + mot de passe actuel).
  4. **⚠️ Supprimer le compte** (mot de passe actuel + taper « SUPPRIMER » + double confirmation).

> 🛡️ Sécurité : impossible de changer quoi que ce soit sans le mot de passe actuel.
> Pas de fuite de timing sur les vérifications, pas d'email volé en 2 clics.

---

## Fichiers livrés (à remplacer / ajouter)

| Fichier | Type | Rôle |
|---|---|---|
| `backend/users.js` | remplacé | + `updatePassword`, `updateEmail`, `deleteUser` |
| `backend/auth.js` | remplacé | + routes `PATCH /api/auth/password`, `PATCH /api/auth/email`, `DELETE /api/auth/account` ; `/me` renvoie aussi `created_at` |
| `frontend/src/components/AccountPage.jsx` | **nouveau** | La page |
| `frontend/src/App.jsx` | remplacé | Branche la page (état + rendu) |
| `frontend/src/components/Sidebar.jsx` | remplacé | + bouton « 👤 Mon compte » et email cliquable |
| `frontend/src/api.js` | remplacé | + `authChangePassword`, `authChangeEmail`, `authDeleteAccount` |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.14.0 |

> ⚠️ Cette livraison **n'inclut pas** `backend/config.js` (rien à y changer cette fois).
> Tu gardes le `config.js` que je t'ai envoyé pour corriger le crash GROUNDING_ENABLED.

> **Aucune nouvelle dépendance npm.**

---

## Tester en local (3 min)

1. Remplace les fichiers, redémarre le backend, recharge la page (Ctrl+Shift+R).
2. En bas à gauche : tu dois voir un nouveau bouton **« 👤 Mon compte »**.
3. Clique dessus. La page s'ouvre dans la zone centrale.
4. **Test mot de passe** : change-le. Reconnecte-toi avec le nouveau. ✓
5. **Test email** : change-le (par exemple en ajoutant `+test` avant le `@`). L'affichage en bas à gauche se met à jour. ✓
6. **Test suppression** (à faire sur un **deuxième compte de test**, pas le tien !) :
   - Crée un compte « test@test.fr ».
   - Va dans Mon compte → Supprimer le compte.
   - Tape ton mot de passe + « SUPPRIMER ».
   - Le compte ET ses conversations disparaissent.

---

## Ce qui se passe sous le capot (mémo)

- Toutes les routes sont **derrière auth** (cookie de session obligatoire).
- Chaque action vérifie le **mot de passe actuel** (`scrypt + timingSafeEqual`).
- Le changement d'email **rafraîchit le cookie** de session (le payload contient l'email).
- La suppression du compte :
  1. supprime **uniquement les conversations dont tu es propriétaire** (les conversations « legacy » sans owner restent — sécurité côté admin),
  2. supprime le compte,
  3. efface le cookie côté client → tu retournes sur l'écran de connexion.

---

## Et après ?

L'**Étape 2 multi-user** (clé OpenRouter par utilisateur) viendra **se brancher dans
cette même page** : on ajoutera un 5e bloc « Ma clé OpenRouter » entre Email et Suppression.
Tu pourras alors envoyer le site en public sans risque pour ton crédit.
