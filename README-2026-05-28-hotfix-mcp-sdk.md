# README — 2026-05-28 — Hotfix v2.16.2 (module @modelcontextprotocol/sdk manquant)

**Fonction principale :** correction du `package.json` (ajout d'une dépendance manquante).

**Version : v2.16.2** (patch)

---

## En 2 phrases

Le déploiement v2.16.1 sur le VPS a planté au démarrage de PM2 car le fichier `backend/retrieval.js` importe `@modelcontextprotocol/sdk`, qui n'était pas déclaré dans `package.json`. Ce hotfix ajoute la dépendance, donc `npm install --omit=dev` sur le VPS l'installe désormais et le backend démarre proprement.

---

## Pourquoi le crash sans rien casser en local

- En **local**, tu avais installé manuellement `@modelcontextprotocol/sdk` à un moment → il était dans `node_modules/` mais **pas listé** dans `package.json`.
- En **production**, le ZIP n'inclut pas `node_modules/` (normal), et le `npm install --omit=dev` du VPS n'a vu que les deps déclarées → manque le module → crash de `retrieval.js` au chargement → PM2 cycle infini.

C'est un classique des projets multi-features où une lib est ajoutée à chaud sans `npm install --save`.

---

## Fichiers livrés

| Fichier | Type | Rôle |
|---|---|---|
| `package.json` | remplacé | + `@modelcontextprotocol/sdk: ^1.0.0` dans deps, version 2.16.2 |
| `frontend/package.json` | remplacé | Version 2.16.2 (cohérence) |
| `CHANGELOG.md` | remplacé | Entrée [2.16.2] |

> **Aucun changement de code applicatif.** Juste les dépendances et la version.

---

## Tu fais (ordre strict)

1. Remplace les 3 fichiers (`package.json`, `frontend/package.json`, `CHANGELOG.md`).
2. Régénère `package-lock.json` cohérent localement :
   ```powershell
   npm install
   ```
   (cela ajoutera `@modelcontextprotocol/sdk` dans le lockfile s'il n'y est pas, et alignera les versions).
3. Relance l'audit :
   ```powershell
   .\audit-precommit-council.ps1
   ```
   → doit afficher 7/7 OK avec version **2.16.2**.
4. Commit + tag + push :
   ```powershell
   git add -A
   git commit -m "fix(deps): ajoute @modelcontextprotocol/sdk pour retrieval.js (v2.16.2)"
   git tag -a v2.16.2 -m "Hotfix v2.16.2 - dependance @modelcontextprotocol/sdk manquante"
   git push origin main --tags
   ```
5. Re-deploy :
   ```powershell
   .\deploy-council.ps1 -LogsAfter
   ```

---

## Vérifier post-deploy

Tu dois voir dans les logs PM2 :
- ✅ `Backend repond sur le port 5706` (au lieu de `[FAIL] Backend NE repond PAS`)
- ✅ Plus aucun `ERR_MODULE_NOT_FOUND`

Puis ouvre `https://council.mesoutilsagile.com` dans le navigateur → écran de login, ou bandeau "ajoute ta clé" si compte sans clé.

---

## Notes

- `retrieval.js` reste **inactif par défaut** (`GROUNDING_ENABLED=false`). Le module est juste chargé mais ne fait rien. Si tu actives la feature grounding plus tard, il fera ses appels MCP.
- `cortex.js` n'est **pas concerné** par ce bug : il fait ses appels via `fetch` directement, sans dépendance externe au SDK.
