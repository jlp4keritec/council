# README — 2026-05-28 — Multi-utilisateur · Étape 3 (Panneau Admin)

**Fonctions principales :**
- `listAllUsers`, `setActive`, `setAdmin`, `adminResetPassword`, `adminDelete` (backend `users.js`)
- `computeUserStats` (backend `server.js`)
- `AdminPage` (frontend, nouvelle page)

**Version : v2.16.0**

> 🎉 **C'est la dernière étape du chantier multi-user.** Avec celle-ci, tu peux gérer tes utilisateurs comme un vrai admin et publier le site en confiance.

---

## En 2 phrases

Un nouveau bouton **« 🛡️ Admin »** apparaît dans la barre de gauche **uniquement pour les admins**. La page affiche les stats globales et un tableau de tous les comptes, avec des actions (reset mot de passe, désactiver, supprimer, promouvoir).

---

## Ce que tu peux faire dans le panneau Admin

**Stats globales** en haut : Utilisateurs · Admins · Avec clé OpenRouter · Conversations · Coût cumulé.

**Tableau par compte** :
- Email · Rôle (Admin/Utilisateur) · État (Actif/Désactivé) · Clé (✓/—) · Date de création
- **Nb de conversations · Coût cumulé · Dernière activité** (« il y a 3j », « hier », etc.)

**Actions par compte** (avec confirmation) :
- 🔑 **Reset mdp** → mot de passe temporaire affiché **une fois** (bouton « Copier »). À transmettre à l'utilisateur, qui le changera dans Mon compte après connexion.
- ⏸️ **Désactiver / ▶ Réactiver** → un compte désactivé ne peut **plus se connecter ni utiliser l'API**, son cookie est révoqué au prochain appel.
- 👑 **Promouvoir / 👤 Rétrograder admin** → utile si tu veux un 2ᵉ admin (ou si tu changes d'avis).
- 🗑️ **Supprimer** → efface le compte + **toutes ses conversations** (deux confirmations).

🛡️ **Garde-fous** :
- Tu ne peux **rien faire sur ton propre compte** (anti-lockout). Pour modifier ton propre compte, va dans « Mon compte ».
- Toutes les routes `/api/admin/*` exigent `is_admin === true` (sinon 403).
- Chaque action est tracée dans les logs du serveur.

---

## Fichiers livrés

| Fichier | Type | Rôle |
|---|---|---|
| `backend/users.js` | remplacé | + opérations admin (`listAllUsers`, `setActive`, `setAdmin`, `adminResetPassword`, `adminDelete`) |
| `backend/auth.js` | remplacé | Bloque les comptes désactivés (preHandler + login) |
| `backend/server.js` | remplacé | + 5 routes `/api/admin/*` + `computeUserStats` |
| `frontend/src/components/AdminPage.jsx` | **nouveau** | La page |
| `frontend/src/App.jsx` | remplacé | Branche AdminPage, propage `isAdmin` à la sidebar |
| `frontend/src/components/Sidebar.jsx` | remplacé | Bouton « 🛡️ Admin » conditionnel |
| `frontend/src/api.js` | remplacé | + 5 méthodes admin + gestion `403 account_disabled` |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.16.0 |
| `CHANGELOG.md` | remplacé | Note 2.16.0 |

> **Aucune nouvelle dépendance.** Aucune modification de `config.js` ni du `.env`.

---

## Tester en local (5 min)

1. Remplace les fichiers, redémarre le backend, **Ctrl+Shift+R** dans le navigateur.
2. Connecte-toi en admin (**toto@test.com**). Tu dois voir un nouveau bouton **« 🛡️ Admin »** entre « Mon compte » et « Configuration ».
3. Clic dessus → page Admin avec tes stats + la liste de tes 2 comptes (toto, alice).

**Test du reset mdp :**

4. Sur la ligne d'**alice@test.fr**, clique **🔑 Reset mdp** → confirme → un mot de passe temporaire de 12 caractères s'affiche. Note-le (ou clic « Copier »).
5. Déconnexion → connecte-toi en **alice** avec le mot de passe temporaire → ça doit marcher ✓.
6. Va dans **Mon compte** d'Alice → change immédiatement ce mot de passe pour un nouveau définitif.

**Test de la désactivation :**

7. En tant qu'admin (toto), désactive **alice** → essaie de te connecter en alice → **rejeté** avec message « Ce compte a été désactivé ».
8. Réactive alice → reconnexion OK.

**Test de la suppression :**

9. Crée un compte bidon `test@test.fr`, puis depuis l'admin de toto, supprime-le → la ligne disparaît du tableau.

---

## Sous le capot (mémo)

- **Comptes désactivés** : un champ `is_disabled: true` est ajouté à l'utilisateur. Le `preHandler` d'auth renvoie 403 + efface le cookie. Le login refuse aussi.
- **Reset mdp** : le serveur génère un mot de passe lisible de 12 caractères, le hashe immédiatement, et renvoie **une seule fois** la version en clair. L'admin doit le transmettre hors-ligne (jamais re-affiché).
- **Stats** : `computeUserStats` parcourt toutes les conversations stockées (sans filtre user) et agrège par `owner`. Les conversations « legacy » (sans owner) ne comptent dans aucun utilisateur.
- **Coût** : somme de tous les `msg.pricing.total.total_cost_usd` (4 décimales).

---

## Fin du chantier multi-user 🎉

Tu as maintenant :
- ✅ Inscription / connexion par email
- ✅ Chacun ses propres conversations (isolation)
- ✅ Page Mon compte (mdp, email, suppression, clé OpenRouter)
- ✅ Mode strict : pas de clé = pas de conseil
- ✅ Panneau Admin complet (reset, désactiver, supprimer, stats détaillées)

→ **Site prêt à être mis en public.** 🚀
