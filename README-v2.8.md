# LLM Council v2.8.0 — Auth + Landing page

## Ce qui change

1. **Auth mono-user** — l'app exige une connexion :
   - Username = `ADMIN_USERNAME` du `.env` (defaut `admin`)
   - Password = `OPENROUTER_API_KEY` (la cle deja en place)
   - Cookie HMAC httpOnly signe avec un secret derive de la cle
   - Session valable 30 jours par defaut (`SESSION_DURATION_DAYS`)
   - Routes `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`
   - Toutes les autres routes `/api/*` sont protegees (401 si non auth)

2. **Landing page sur la racine** — `https://council.mesoutilsagile.com/` sert
   maintenant la landing statique (`frontend/dist/landing.html`). Le bouton
   "Lancer le Council" pointe vers `/app` qui retombe dans le SPA et affiche
   la page de Login si pas authentifie.

3. **Page de Login** — design aligne sur la charte de l'app (bleu `#4a90e2`,
   fond `#f8f9fa`, system fonts).

4. **Bouton "Deconnexion"** en bas de la sidebar.

## Fichiers livres

| Fichier | Action |
|---|---|
| `backend/auth.js` | **NOUVEAU** |
| `backend/config.js` | REMPLACE (ajout `ADMIN_USERNAME`, `SESSION_DURATION_DAYS`) |
| `backend/server.js` | REMPLACE (integration auth) |
| `frontend/src/api.js` | REMPLACE (credentials: include + endpoints auth + handle 401) |
| `frontend/src/App.jsx` | REMPLACE (check auth au boot, affiche Login si 401) |
| `frontend/src/components/Login.jsx` | **NOUVEAU** |
| `frontend/src/components/Login.css` | **NOUVEAU** |
| `frontend/src/components/Sidebar.jsx` | REMPLACE (ajout bouton deconnexion en pied) |
| `frontend/src/index.css` | REMPLACE (styles bandeau auth ajoutes a la fin) |
| `frontend/public/landing.html` | **NOUVEAU** (bouton CTA pointe vers `/app`) |
| `package.json` | REMPLACE (version 2.8.0, aucune nouvelle dep) |
| `deploy-council.ps1` | REMPLACE (Nginx + landing + patch .env automatique) |

**Aucune nouvelle dependance npm.** L'auth utilise seulement `crypto` (natif Node).

## Application

```powershell
cd C:\Agile\llm-council-node

# Backup (skill backup-script recommande)
Copy-Item -Recurse -Force . ..\llm-council-node.backup.v27

# Remplacer les fichiers (extraire le ZIP ici)
# ... extraire les fichiers livres ...

# Deployer avec regen Nginx (necessaire la premiere fois pour activer la landing)
.\deploy-council.ps1 -UpdateNginx
```

Les fois suivantes, un simple `.\deploy-council.ps1` suffit (la conf Nginx ne
change plus, et le patch `.env` est idempotent).

## Verification post-deploiement

```powershell
# 1. La racine sert la landing
curl https://council.mesoutilsagile.com/
# -> doit retourner du HTML avec "<title>LLM Council — Plusieurs IA..."

# 2. /app retourne le SPA
curl -I https://council.mesoutilsagile.com/app
# -> 200 OK (content-type: text/html)

# 3. /api/usage sans cookie -> 401
curl https://council.mesoutilsagile.com/api/usage
# -> {"error":"unauthorized","message":"Session invalide ou expiree"}

# 4. Login + cookie
$apiKey = "sk-or-v1-..."   # ta cle OpenRouter
$body = @{ username = "admin"; password = $apiKey } | ConvertTo-Json
curl -X POST https://council.mesoutilsagile.com/api/auth/login `
     -H "Content-Type: application/json" `
     -d $body -c cookies.txt
# -> {"authenticated":true,"username":"admin",...}

# 5. Avec le cookie, /api/usage repond 200
curl https://council.mesoutilsagile.com/api/usage -b cookies.txt
```

## Workflow utilisateur

1. Visiteur arrive sur `https://council.mesoutilsagile.com/` -> **landing page**
2. Clique sur "Lancer le Council" -> `https://council.mesoutilsagile.com/app`
3. App React charge, check `/api/auth/me` -> 401 -> **page Login s'affiche**
4. Saisit `admin` + la cle OpenRouter -> cookie pose -> **app affichee**
5. Session valable 30 jours (cookie persistent)
6. Clic "Deconnexion" en bas de sidebar -> retour Login

## Securite

- Cookie `HttpOnly` + `Secure` (en prod) + `SameSite=Lax` -> protege contre XSS et CSRF basique
- Signature HMAC-SHA256 avec secret derive de `OPENROUTER_API_KEY`
- Comparaison password en temps constant (`timingSafeEqual`)
- Pause anti-bruteforce de 300ms sur login echoue
- Si la cle OpenRouter change -> toutes les sessions sont invalidees (comportement attendu)
- Aucun stockage de password ailleurs que la `.env` deja secrete

## Configuration

Variables `.env` :
```bash
# Existantes (inchangees)
OPENROUTER_API_KEY=sk-or-v1-...   # PASSWORD du compte admin
NODE_ENV=production               # active Secure cookie

# Nouvelles v2.8
ADMIN_USERNAME=admin              # nom d'utilisateur (defaut "admin")
SESSION_DURATION_DAYS=30          # duree session en jours (defaut 30)
```

Pour changer le username ou la duree de session : edite `.env` sur le VPS puis
`pm2 restart llm-council`. Les sessions existantes restent valides jusqu'a leur
expiration naturelle.

## Pour reset toutes les sessions

```bash
# Sur le VPS
ssh ubuntu@151.80.232.214
# Rotate la cle OpenRouter dans .env (le secret HMAC change avec)
pm2 restart llm-council
# -> tous les cookies existants sont invalides, tout le monde doit se relogger
```

## Rollback en cas de probleme

Si tout casse, retour a la v2.7.1 :
```powershell
Remove-Item -Recurse -Force .\llm-council-node
Rename-Item .\llm-council-node.backup.v27 .\llm-council-node
.\deploy-council.ps1 -UpdateNginx
```
