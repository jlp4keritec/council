# =============================================================================
# fix-council-ssl.ps1 v2
# =============================================================================
# Regenere le vhost Nginx + relance Certbot pour council.mesoutilsagile.com.
# Aucune modification de .env, PM2, ou code. Pure operation Nginx + SSL.
#
# A lancer quand https://council.mesoutilsagile.com tombe sur Umami (defaut)
# au lieu du Council -- typiquement parce que le bloc SSL n'a pas ete cree
# ou a ete supprime. Meme pattern que les fixes fedlex/eurlex de mai 2026.
#
# v2 : on n'ecrit QUE le vhost HTTP. On laisse Certbot generer le bloc HTTPS
#      lui-meme, avec la syntaxe compatible Nginx 1.18+ d'Ubuntu 22 LTS
#      ("listen 443 ssl http2;" en parametre du listen, pas "http2 on;").
#
# Convention skill powershell-bash-escapes :
#   - Strings PS ASCII pur (Unicode dans commentaires uniquement)
#   - Bash transite via heredoc @'...'@ + base64
#   - Variables PS injectees via markers __VAR__ + -replace
# =============================================================================

param(
    [string]$Email = $null,
    [string]$ProjectPath = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

$DOMAIN    = "mesoutilsagile.com"
$SUBDOMAIN = "council"
$FQDN      = "$SUBDOMAIN.$DOMAIN"
$APP_PORT  = 5706
$REMOTE_DIR = "/home/ubuntu/llm-council"

function Write-Step { param($m) Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] >> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "   OK  $m"     -ForegroundColor Green }
function Write-Info { param($m) Write-Host "   ... $m"     -ForegroundColor Gray }
function Write-Fail { param($m) Write-Host "   ERREUR $m"  -ForegroundColor Red }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Fix SSL Council v2 -- regen vhost + certbot" -ForegroundColor Cyan
Write-Host "  Cible : https://$FQDN" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# Config SSH
# -----------------------------------------------------------------------------
function Get-DeployConfig {
    $candidates = @(
        (Join-Path $PSScriptRoot "deploy-config.json"),
        (Join-Path (Get-Location) "deploy-config.json"),
        "C:\vpn\wg-vpn-deploy\deploy-config.json",
        "C:\Agile\deploy-config.json"
    )
    foreach ($p in $candidates) {
        if (Test-Path $p) {
            Write-Info "Config SSH : $p"
            return Get-Content $p -Raw | ConvertFrom-Json
        }
    }
    throw "deploy-config.json introuvable"
}

function Get-SshArgs {
    param($cfg)
    $a = @("-o","StrictHostKeyChecking=no","-o","ConnectTimeout=15","-p",$cfg.port)
    if ($cfg.authMethod -eq "key" -and $cfg.sshKeyPath) { $a += "-i", $cfg.sshKeyPath }
    return $a
}

function Invoke-SshBashScript {
    param($cfg, $script)
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
    $sshArgs = Get-SshArgs $cfg
    & ssh @sshArgs "$($cfg.user)@$($cfg.host)" "echo $b64 | base64 -d | bash -s" | Out-Host
    return $LASTEXITCODE
}

$cfg = Get-DeployConfig

if (-not $Email) {
    $Email = Read-Host "Email pour Let's Encrypt (renewal notifications)"
    if ([string]::IsNullOrWhiteSpace($Email)) {
        Write-Fail "Email requis pour Certbot. Abandon."
        exit 1
    }
}

# -----------------------------------------------------------------------------
# Diagnostic prealable
# -----------------------------------------------------------------------------
Write-Step "Diagnostic Nginx actuel pour $FQDN"

$diagBash = @'
set -e
echo "===== Version Nginx ====="
nginx -v 2>&1
echo ""
echo "===== Vhosts contenant council.mesoutilsagile.com ====="
sudo grep -l "council.mesoutilsagile.com" /etc/nginx/sites-enabled/* 2>/dev/null || echo "(aucun)"
echo ""
echo "===== Blocs server pour ce domaine ====="
sudo nginx -T 2>/dev/null | awk '/server_name council.mesoutilsagile.com/,/^}/' | head -60
echo ""
echo "===== Y a-t-il un cert Let's Encrypt deja existant pour council ? ====="
sudo ls -la /etc/letsencrypt/live/council.mesoutilsagile.com/ 2>/dev/null || echo "(aucun cert)"
'@

$rc = Invoke-SshBashScript $cfg $diagBash
if ($rc -ne 0) { Write-Fail "Diagnostic a echoue (code $rc)"; exit 1 }

Write-Host ""
$confirm = Read-Host "Continuer avec la regen du vhost + Certbot ? (o/N)"
if ($confirm -ne 'o' -and $confirm -ne 'O') {
    Write-Info "Abandon par l utilisateur."
    exit 0
}

# -----------------------------------------------------------------------------
# Regen du vhost HTTP uniquement
# Certbot va ajouter ensuite le bloc HTTPS lui-meme avec la bonne syntaxe
# (compatible avec la version Nginx installee).
# -----------------------------------------------------------------------------
Write-Step "Regeneration du vhost HTTP pour $FQDN"

$vhostBashTemplate = @'
set -e
FQDN=__FQDN__
APP_PORT=__APP_PORT__
REMOTE_DIR=__REMOTE_DIR__
VHOST_PATH=/etc/nginx/sites-available/$FQDN.conf

# Backup
if [ -f "$VHOST_PATH" ]; then
  sudo cp "$VHOST_PATH" "$VHOST_PATH.backup.$(date +%s)"
  echo "[OK] Backup de l'ancien vhost cree"
fi

# Vhost HTTP simple (Certbot va ajouter le bloc HTTPS apres)
# server_name EXPLICITE pour battre tout default_server (notamment Umami)
sudo tee "$VHOST_PATH" > /dev/null <<NGINXEOF
# Vhost regenere par fix-council-ssl.ps1
# server_name EXPLICITE pour battre tout default_server (notamment Umami)

server {
    listen 80;
    listen [::]:80;
    server_name $FQDN;

    # --- Frontend statique (build Vite) ---
    root $REMOTE_DIR/frontend/dist;
    index index.html;

    # --- API Fastify (blocking) ---
    location /api/ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
    }

    # --- SSE streaming ---
    location ~ ^/api/.+/stream\$ {
        proxy_pass http://127.0.0.1:$APP_PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding off;
        proxy_read_timeout 600s;
    }

    # --- Health endpoint ---
    location /health {
        proxy_pass http://127.0.0.1:$APP_PORT/health;
    }

    # --- Landing page sur la racine ---
    location = / {
        try_files /landing.html =404;
    }

    # --- SPA fallback (Council React app) ---
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

# Symlink dans sites-enabled
sudo ln -sf "$VHOST_PATH" "/etc/nginx/sites-enabled/$FQDN.conf"
echo "[OK] Vhost HTTP cree : $VHOST_PATH"

# Permissions Nginx
sudo chmod o+x /home/ubuntu 2>/dev/null || true
sudo chmod -R o+rX "$REMOTE_DIR/frontend/dist" 2>/dev/null || true

# Test + reload
echo ""
echo "===== nginx -t ====="
sudo nginx -t
sudo systemctl reload nginx
echo "[OK] Nginx recharge avec vhost HTTP"
'@

$vhostBash = $vhostBashTemplate `
    -replace '__FQDN__',       $FQDN `
    -replace '__APP_PORT__',   $APP_PORT.ToString() `
    -replace '__REMOTE_DIR__', $REMOTE_DIR

$rc = Invoke-SshBashScript $cfg $vhostBash
if ($rc -ne 0) { Write-Fail "Regen vhost HTTP a echoue (code $rc)"; exit 1 }
Write-Ok "Vhost HTTP cree et Nginx recharge"

# -----------------------------------------------------------------------------
# Certbot : ajoute le bloc HTTPS avec la syntaxe compatible Nginx 1.18+
# (utilise "listen 443 ssl;" + ajoute http2 separement, ou pas, selon version)
# -----------------------------------------------------------------------------
Write-Step "Lancement Certbot pour $FQDN"

$certbotBashTemplate = @'
set -e
FQDN=__FQDN__
EMAIL=__EMAIL__

sudo certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect \
    -d "$FQDN"

echo ""
echo "[OK] SSL configure pour $FQDN"
echo ""
echo "===== Verification finale du vhost (apres Certbot) ====="
sudo nginx -T 2>/dev/null | awk "/server_name $FQDN;/,/^}/" | head -80
echo ""
echo "===== nginx -t final ====="
sudo nginx -t
'@

$certbotBash = $certbotBashTemplate `
    -replace '__FQDN__',  $FQDN `
    -replace '__EMAIL__', $Email

$rc = Invoke-SshBashScript $cfg $certbotBash
if ($rc -ne 0) {
    Write-Fail "Certbot a renvoye une erreur. Verifications :"
    Write-Host "  1. Le DNS de $FQDN pointe-t-il bien vers le VPS ?" -ForegroundColor Yellow
    Write-Host "     -> nslookup $FQDN doit retourner 151.80.232.214" -ForegroundColor Yellow
    Write-Host "  2. Le port 80 est-il ouvert ?" -ForegroundColor Yellow
    Write-Host "  3. Limite Let's Encrypt atteinte ? (5 certs/semaine par domaine)" -ForegroundColor Yellow
    exit 1
}

Write-Ok "Certbot OK : HTTPS actif sur https://$FQDN"

# -----------------------------------------------------------------------------
# Test final cote client (curl depuis le VPS, en HTTPS)
# -----------------------------------------------------------------------------
Write-Step "Test final cote client"

$testBashTemplate = @'
set -e
FQDN=__FQDN__

echo "===== HTTPS racine (doit retourner la landing LLM Council, pas Umami) ====="
HTTP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://$FQDN/")
echo "HTTP code : $HTTP_CODE"

SAMPLE=$(curl -sk "https://$FQDN/" | head -c 800)
if echo "$SAMPLE" | grep -qi "umami"; then
  echo "[FAIL] La page contient encore Umami :"
  echo "$SAMPLE" | head -15
  exit 1
elif echo "$SAMPLE" | grep -qi "council\|<!DOCTYPE\|<html"; then
  echo "[OK] Page valide (pas Umami)"
  echo "Title de la page :"
  echo "$SAMPLE" | grep -oE "<title>[^<]+</title>" | head -1
else
  echo "[WARN] Page inattendue :"
  echo "$SAMPLE" | head -5
fi

echo ""
echo "===== HTTPS /app (SPA Council) ====="
APP_CODE=$(curl -sk -o /dev/null -w "%{http_code}" "https://$FQDN/app")
echo "HTTP code : $APP_CODE"

echo ""
echo "===== HTTPS /api/auth/me (doit retourner 401 - non authentifie) ====="
curl -sk -w "\nHTTP code : %{http_code}\n" "https://$FQDN/api/auth/me"
'@

$testBash = $testBashTemplate -replace '__FQDN__', $FQDN

Invoke-SshBashScript $cfg $testBash | Out-Null

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  TERMINE" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Etapes suivantes cote browser :" -ForegroundColor Yellow
Write-Host "  1. Ouvrir https://$FQDN en NAVIGATION PRIVEE" -ForegroundColor Yellow
Write-Host "     -> doit afficher la landing (pas Umami)" -ForegroundColor Yellow
Write-Host "  2. Si OK : vider le cache du browser normal" -ForegroundColor Yellow
Write-Host "     Ctrl+Shift+Delete > 'Site data' pour $FQDN" -ForegroundColor Yellow
Write-Host "     OU DevTools (F12) > Application > Clear storage" -ForegroundColor Yellow
Write-Host ""
