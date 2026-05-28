# README — 2026-05-28 — UI propre (popups + dates précises)

**Fonctions principales :**
- `ConfirmProvider`, `useConfirm` (frontend `ConfirmDialog.jsx`)
- `fmtDateTime` (frontend `AdminPage.jsx`)

**Version : v2.16.1** (correctif UI)

---

## En 2 phrases

Toutes les **popups natives du navigateur** (« localhost:5180 indique… ») sont remplacées par une **modale propre custom**. Les dates du panneau Admin passent en format **précis `JJ/MM/AAAA HH:MM`** (plus de « jamais » / « aujourd'hui »).

---

## Fichiers livrés

| Fichier | Type | Rôle |
|---|---|---|
| `frontend/src/components/ConfirmDialog.jsx` | **nouveau** | Provider + hook `useConfirm()` |
| `frontend/src/App.jsx` | remplacé | Wrap avec `<ConfirmProvider>` |
| `frontend/src/components/Sidebar.jsx` | remplacé | Déconnexion + suppression conv en `useConfirm` |
| `frontend/src/components/AccountPage.jsx` | remplacé | Suppression clé + compte en `useConfirm` |
| `frontend/src/components/AdminPage.jsx` | remplacé | Tous les confirms + alerts → modale/toast |
| `package.json` / `frontend/package.json` | remplacés | Version → 2.16.1 |
| `CHANGELOG.md` | remplacé | Note 2.16.1 |

> **Aucune nouvelle dépendance.** Aucune modification backend.

---

## Tester

1. Remplace, **Ctrl+Shift+R**.
2. Sidebar → clique « Déconnexion » → ✓ modale propre (plus de popup « localhost indique »).
3. Sidebar → clique sur la croix d'une conversation → ✓ modale propre.
4. Mon compte → Supprimer la clé → ✓ modale propre.
5. Mon compte → Supprimer le compte (taper SUPPRIMER) → ✓ modale rouge propre.
6. Admin → Reset mdp / Désactiver / Promouvoir / Supprimer → ✓ modale propre à chaque fois.
7. Admin → colonnes « Créé » et « Dernière activité » → ✓ format `28/05/2026 21:13`.

---

## Sous le capot

- `useConfirm()` renvoie une **promesse** : `const ok = await confirm({ title, message, confirmLabel, danger });`
- La modale écoute **Échap** (annuler) et **Entrée** (confirmer).
- Le toast d'erreur en haut de la page Admin disparaît seul après 3,5 s.
