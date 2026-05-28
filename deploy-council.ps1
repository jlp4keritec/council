# =============================================================================
# deploy-council.ps1 -- Deploiement du LLM Council (Node.js) sur le VPS OVH
# =============================================================================
# Conventions respectees (cf. skills deploy-vps + powershell-bash-escapes) :
#   - Strings PS en ASCII pur (Unicode dans commentaires uniquement)
#   - Bash distant transite en heredoc @'...'@ + base64
#   - Variables PS injectees via markers __VAR__ et -replace
#   - Pas de mot de passe SSH (cle uniquement depuis deploy-config.json)
#   - PM2 delete + start (jamais restart seul)
#   - nginx -t avant reload
#   - Exclusions ZIP strictes (.env, node_modules, data/, etc.)
#
# Usage :
#   .\deploy-council.ps1           # mise a jour standard
#   .\deploy-council.ps1 -Init     # premier deploiement (Nginx + Certbot + .env genere)
#   .\deploy-council.ps1 -SkipBuild         # saute le build frontend (deja fait)
#   .\deploy-council.ps1 -SkipNginx -SkipCertbot   # debug
#   .\deploy-council.ps1 -LogsAfter         # affiche pm2 logs apres deploy
#   .\deploy-council.ps1 -UpdateNginx       # force la regen de la conf Nginx
#
# v2.16.1 : ajout automatique des vars multi-user au .env si absentes
#           (SESSION_SECRET et OPENROUTER_KEYS_SECRET generes via openssl)
# =============================================================================

param(
    [switch]$Init,
    [switch]$SkipBuild,
    [switch]$SkipNginx,
    [switch]$SkipCertbot,
    [switch]$LogsAfter,
    [switch]$UpdateNginx,
    [string]$ProjectPath = $PSScriptRoot
)

$ErrorActionPreference = "Stop"

# -----------------------------------------------------------------------------
# Variables projet
# -----------------------------------------------------------------------------
$PROJECT_NAME = "llm-council"
$REMOTE_DIR   = "/home/ubuntu/$PROJECT_NAME"
$DOMAIN       = "mesoutilsagile.com"
$SUBDOMAIN    = "council"
$FQDN         = "$SUBDOMAIN.$DOMAIN"
$APP_PORT     = 5706
$PM2_NAME     = $PROJECT_NAME

# -----------------------------------------------------------------------------
# Output helpers (ASCII pur)
# -----------------------------------------------------------------------------
function Write-Step { param($m) Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] >> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "   OK  $m"     -ForegroundColor Green }
function Write-Info { param($m) Write-Host "   ... $m"     -ForegroundColor Gray }
function Write-Warn { param($m) Write-Host "   !!  $m"     -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "   ERREUR $m"  -ForegroundColor Red }

function Show-Banner {
    Write-Host ""
    Write-Host "==================================================" -ForegroundColor Cyan
    Write-Host "  LLM Council (Node.js) -- Deploy to $FQDN" -ForegroundColor Cyan
    Write-Host "  Port: $APP_PORT  /  PM2: $PM2_NAME" -ForegroundColor Cyan
    Write-Host "==================================================" -ForegroundColor Cyan
}

# -----------------------------------------------------------------------------
# Config SSH (priorite C:\Agile\deploy-config.json)
# -----------------------------------------------------------------------------
function Get-DeployConfig {
    $candidates = @(
        (Join-Path $PSScriptRoot "deploy-config.json"),
        (Join-Path (Get-Location) "deploy-config.json"),
        (Join-Path $ProjectPath "deploy-config.json"),
        "C:\vpn\wg-vpn-deploy\deploy-config.json",
        "C:\Agile\deploy-config.json"
    )

    foreach ($p in $candidates) {
        if (Test-Path $p) {
            Write-Info "Config SSH : $p"
            return Get-Content $p -Raw | ConvertFrom-Json
        }
    }

    Write-Fail "Aucun deploy-config.json trouve. Cherche dans :"
    $candidates | ForEach-Object { Write-Host "      $_" }
    throw "deploy-config.json manquant"
}

function Get-SshArgs {
    param($cfg)
    $a = @("-o","StrictHostKeyChecking=no","-o","ConnectTimeout=15","-p",$cfg.port)
    if ($cfg.authMethod -eq "key" -and $cfg.sshKeyPath) { $a += "-i", $cfg.sshKeyPath }
    return $a
}

function Invoke-SshCommand {
    param($cfg, $cmd)
    $sshArgs = Get-SshArgs $cfg
    & ssh @sshArgs "$($cfg.user)@$($cfg.host)" $cmd | Out-Host
    return $LASTEXITCODE
}

function Invoke-SshBashScript {
    # Pattern obligatoire (skill powershell-bash-escapes Regle 5) : heredoc + base64
    param($cfg, $script)
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($script))
    $sshArgs = Get-SshArgs $cfg
    & ssh @sshArgs "$($cfg.user)@$($cfg.host)" "echo $b64 | base64 -d | bash -s" | Out-Host
    return $LASTEXITCODE
}

function Invoke-Scp {
    param($cfg, $local, $remote)
    $scpArgs = @("-o","StrictHostKeyChecking=no","-P",$cfg.port)
    if ($cfg.authMethod -eq "key" -and $cfg.sshKeyPath) { $scpArgs += "-i", $cfg.sshKeyPath }
    $scpArgs += $local, "$($cfg.user)@$($cfg.host):$remote"
    & scp @scpArgs | Out-Host
    return $LASTEXITCODE
}

# -----------------------------------------------------------------------------
# Test SSH
# -----------------------------------------------------------------------------
function Test-SshConnection {
    param($cfg)
    Write-Step "Test connexion SSH"
    $rc = Invoke-SshCommand $cfg "echo OK"
    if ($rc -ne 0) { throw "SSH inaccessible (code $rc)" }
    Write-Ok "SSH operationnel"
}

# -----------------------------------------------------------------------------
# Build frontend (Vite -> frontend/dist/)
# -----------------------------------------------------------------------------
function Build-Frontend {
    if ($SkipBuild) {
        Write-Step "Build frontend (SKIP)"
        return
    }
    Write-Step "Build frontend"
    $frontendDir = Join-Path $ProjectPath "frontend"
    if (-not (Test-Path $frontendDir)) { throw "frontend/ introuvable dans $ProjectPath" }

    Push-Location $frontendDir
    try {
        if (-not (Test-Path "node_modules")) {
            Write-Info "npm install"
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm install a echoue" }
        }
        Write-Info "npm run build"
        & npm run build
        if ($LASTEXITCODE -ne 0) { throw "npm run build a echoue" }
        if (-not (Test-Path "dist")) { throw "frontend/dist/ pas cree" }
        Write-Ok "Frontend build dans frontend/dist/"
    }
    finally {
        Pop-Location
    }
}

# -----------------------------------------------------------------------------
# Packaging ZIP (exclusions strictes)
# -----------------------------------------------------------------------------
function New-DeployPackage {
    Write-Step "Creation du package deploy.zip"

    $zipPath = Join-Path $ProjectPath "deploy.zip"
    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }

    # Exclusion par SEGMENT (matche partout dans le chemin, pas seulement a la racine)
    $excludeSegments = @(
        "node_modules", ".git", ".vscode", ".idea", "logs",
        "data", ".vite"
    )
    # On garde 'dist' explicitement pour que frontend/dist (build Vite) parte sur le VPS

    $excludePatterns = @(
        "*.log", "*.zip", "*.bak", "*.tmp",
        ".env", ".env.*", ".envold", "deploy-config.json"
    )

    $allItems = Get-ChildItem -Path $ProjectPath -Recurse -Force -File | Where-Object {
        $rel = $_.FullName.Substring($ProjectPath.Length).TrimStart('\','/')
        $segments = $rel -split '[\\/]'

        $excluded = $false
        foreach ($seg in $segments) {
            if ($excludeSegments -contains $seg) { $excluded = $true; break }
        }
        if (-not $excluded) {
            foreach ($p in $excludePatterns) {
                if ($_.Name -like $p) { $excluded = $true; break }
            }
        }
        -not $excluded
    }

    Write-Info "$($allItems.Count) fichiers a inclure"

    Add-Type -AssemblyName System.IO.Compression -ErrorAction SilentlyContinue
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue

    $zip = [System.IO.Compression.ZipFile]::Open(
        $zipPath,
        [System.IO.Compression.ZipArchiveMode]::Create
    )
    try {
        foreach ($item in $allItems) {
            $rel = $item.FullName.Substring($ProjectPath.Length).TrimStart('\','/').Replace('\','/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $zip, $item.FullName, $rel,
                [System.IO.Compression.CompressionLevel]::Optimal
            ) | Out-Null
        }
    }
    finally {
        $zip.Dispose()
    }

    $size = (Get-Item $zipPath).Length / 1MB
    Write-Ok ("deploy.zip cree ({0:N2} MB)" -f $size)
    return $zipPath
}

# -----------------------------------------------------------------------------
# Upload
# -----------------------------------------------------------------------------
function Send-DeployPackage {
    param($cfg, $zipPath)
    Write-Step "Upload deploy.zip vers le VPS"
    $rc = Invoke-Scp $cfg $zipPath "/tmp/llm-council-deploy.zip"
    if ($rc -ne 0) { throw "scp a echoue (code $rc)" }
    Write-Ok "Upload termine"
}

# -----------------------------------------------------------------------------
# Verif pre-requis (Node + unzip)
# -----------------------------------------------------------------------------
function Install-VpsPrerequisites {
    param($cfg)
    Write-Step "Verification des pre-requis VPS"

    $bash = @'
set -e
echo "Node:   $(node --version 2>&1)"
echo "PM2:    $(pm2 --version 2>&1 || echo MISSING)"
echo "Nginx:  $(nginx -v 2>&1)"

if ! command -v unzip > /dev/null; then
  sudo apt-get install -y unzip
fi
if ! command -v openssl > /dev/null; then
  sudo apt-get install -y openssl
fi

NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ATTENTION : Node $NODE_MAJOR detecte, version >= 20 requise pour LLM Council"
fi
'@
    $rc = Invoke-SshBashScript $cfg $bash
    if ($rc -ne 0) { throw "Verification pre-requis a echoue" }
    Write-Ok "Pre-requis VPS OK"
}

# -----------------------------------------------------------------------------
# Extract + npm install + PM2
# -----------------------------------------------------------------------------
function Invoke-CodeDeploy {
    param(
        $cfg,
        [switch]$SkipPm2
    )
    if ($SkipPm2) {
        Write-Step "Extraction + npm install (PM2 sera demarre apres creation du .env)"
    } else {
        Write-Step "Extraction + npm install + restart PM2"
    }

    if ($SkipPm2) { $doPm2Flag = "0" } else { $doPm2Flag = "1" }

    $bashTemplate = @'
set -e

REMOTE_DIR=__REMOTE_DIR__
PM2_NAME=__PM2_NAME__
APP_PORT=__APP_PORT__
DO_PM2=__DO_PM2__

echo "==> 1. Backup eventuel (.env + data/)"
mkdir -p "$REMOTE_DIR" 2>/dev/null || true
[ -f "$REMOTE_DIR/.env" ] && sudo cp "$REMOTE_DIR/.env" /tmp/llm-council-env-backup
[ -d "$REMOTE_DIR/data" ] && sudo cp -r "$REMOTE_DIR/data" /tmp/llm-council-data-backup
echo "[OK] backup effectue"

echo "==> 2. Extraction du ZIP"
rm -rf /tmp/llm-council-extract
mkdir -p /tmp/llm-council-extract
unzip -o /tmp/llm-council-deploy.zip -d /tmp/llm-council-extract > /dev/null
echo "[OK] zip extrait"

echo "==> 3. Rsync vers $REMOTE_DIR"
sudo rsync -a --delete \
    --exclude='.env' \
    --exclude='.env.*' \
    --exclude='data/' \
    --exclude='node_modules/' \
    --exclude='logs/' \
    /tmp/llm-council-extract/ "$REMOTE_DIR/"

echo "==> 4. Restauration .env / data"
[ -f /tmp/llm-council-env-backup ] && sudo mv /tmp/llm-council-env-backup "$REMOTE_DIR/.env"
[ -d /tmp/llm-council-data-backup ] && sudo cp -r /tmp/llm-council-data-backup "$REMOTE_DIR/data"

sudo chown -R $USER:$USER "$REMOTE_DIR"

echo "==> 4b. Patch .env -- ajoute vars manquantes (v2.8 mono-user + v2.16 multi-user)"
ENV_FILE="$REMOTE_DIR/.env"
if [ -f "$ENV_FILE" ]; then

  # ---- v2.8 (mono-user) ----
  if ! grep -q "^ADMIN_USERNAME=" "$ENV_FILE"; then
    echo "" >> "$ENV_FILE"
    echo "# v2.8 -- Auth mono-user (admin legacy)" >> "$ENV_FILE"
    echo "ADMIN_USERNAME=admin" >> "$ENV_FILE"
    echo "[OK] ADMIN_USERNAME ajoute"
  fi
  if ! grep -q "^SESSION_DURATION_DAYS=" "$ENV_FILE"; then
    echo "SESSION_DURATION_DAYS=30" >> "$ENV_FILE"
    echo "[OK] SESSION_DURATION_DAYS ajoute"
  fi
  if ! grep -q "^NODE_ENV=" "$ENV_FILE"; then
    echo "NODE_ENV=production" >> "$ENV_FILE"
    echo "[OK] NODE_ENV=production ajoute (cookie Secure actif)"
  fi

  # ---- v2.16 multi-user ----
  # IMPORTANT : les secrets aleatoires sont generes UNE SEULE FOIS
  # (si absents). Ne JAMAIS regenerer ou ecraser, sinon :
  #  - SESSION_SECRET regenere = toutes les sessions actives invalidees
  #  - OPENROUTER_KEYS_SECRET regenere = cles OpenRouter chiffrees illisibles

  if ! grep -q "^SESSION_SECRET=" "$ENV_FILE"; then
    SECRET=$(openssl rand -hex 32)
    echo "" >> "$ENV_FILE"
    echo "# v2.16 -- Multi-user" >> "$ENV_FILE"
    echo "SESSION_SECRET=$SECRET" >> "$ENV_FILE"
    echo "[OK] SESSION_SECRET genere (32 octets aleatoires)"
  fi
  if ! grep -q "^OPENROUTER_KEYS_SECRET=" "$ENV_FILE"; then
    SECRET=$(openssl rand -hex 32)
    echo "OPENROUTER_KEYS_SECRET=$SECRET" >> "$ENV_FILE"
    echo "[OK] OPENROUTER_KEYS_SECRET genere (chiffrement cles OpenRouter par user)"
  fi
  if ! grep -q "^PASSWORD_MIN_LENGTH=" "$ENV_FILE"; then
    echo "PASSWORD_MIN_LENGTH=8" >> "$ENV_FILE"
    echo "[OK] PASSWORD_MIN_LENGTH=8 ajoute"
  fi
  if ! grep -q "^USERS_FILE=" "$ENV_FILE"; then
    echo "USERS_FILE=data/users.json" >> "$ENV_FILE"
    echo "[OK] USERS_FILE ajoute"
  fi
  if ! grep -q "^LEADERBOARD_FILE=" "$ENV_FILE"; then
    echo "LEADERBOARD_FILE=data/leaderboard.json" >> "$ENV_FILE"
    echo "[OK] LEADERBOARD_FILE ajoute"
  fi

  # ---- Permissions strictes sur le .env (contient des secrets) ----
  chmod 600 "$ENV_FILE"
fi

echo "==> 5. npm install (backend)"
cd "$REMOTE_DIR"
npm install --omit=dev --no-audit --no-fund 2>&1 | tail -5
echo "[OK] deps Node installees"

if [ "$DO_PM2" = "1" ]; then
  echo "==> 6. PM2 delete + start (reset cache env)"
  cd "$REMOTE_DIR"
  pm2 delete "$PM2_NAME" 2>/dev/null || true
  pm2 start ecosystem.config.cjs
  pm2 save > /dev/null
  sleep 2

  echo "==> 7. Health check local"
  HTTP=$(curl -s -o /tmp/health.json -w "%{http_code}" "http://localhost:$APP_PORT/health" || echo "000")
  echo "HTTP: $HTTP"
  if [ "$HTTP" = "200" ]; then
    echo "[OK] Backend repond sur le port $APP_PORT"
  else
    echo "[FAIL] Backend NE repond PAS. Logs PM2 :"
    pm2 logs "$PM2_NAME" --lines 20 --nostream
    exit 1
  fi
else
  echo "==> 6. PM2 skippe (-Init : sera demarre apres creation du .env)"
fi
'@

    $bash = $bashTemplate `
        -replace '__REMOTE_DIR__', $REMOTE_DIR `
        -replace '__PM2_NAME__',   $PM2_NAME `
        -replace '__APP_PORT__',   $APP_PORT `
        -replace '__DO_PM2__',     $doPm2Flag

    $rc = Invoke-SshBashScript $cfg $bash
    if ($rc -ne 0) { throw "Deploy code a echoue (code $rc)" }
    if ($SkipPm2) {
        Write-Ok "Code deploye, npm install OK, PM2 sera demarre apres .env"
    } else {
        Write-Ok "Code deploye + PM2 actif + health 200"
    }
}

# -----------------------------------------------------------------------------
# Init .env (premier deploiement seulement, mode -Init)
# -----------------------------------------------------------------------------
function Initialize-RemoteEnv {
    param($cfg)
    Write-Step "Generation .env initial (premier deploiement)"

    $apiKey = Read-Host "OpenRouter API Key admin (sk-or-v1-...)"
    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        throw "OPENROUTER_API_KEY est REQUIS pour que l'app fonctionne"
    }

    $bashTemplate = @'
set -e
REMOTE_DIR=__REMOTE_DIR__
API_KEY=__API_KEY__
FQDN=__FQDN__

# Generer secrets aleatoires
SESSION_SECRET=$(openssl rand -hex 32)
KEYS_SECRET=$(openssl rand -hex 32)

cat > "$REMOTE_DIR/.env" <<ENVEOF
OPENROUTER_API_KEY=$API_KEY
OPENROUTER_HTTP_REFERER=https://$FQDN
OPENROUTER_X_TITLE=LLM Council

COUNCIL_MODELS=openai/gpt-5.1,google/gemini-3-pro-preview,anthropic/claude-sonnet-4.5,x-ai/grok-4
CHAIRMAN_MODEL=anthropic/claude-opus-4.6
TITLE_MODEL=google/gemini-2.5-flash

EVAL_CRITERIA=precision factuelle, pertinence par rapport a la question, profondeur d'analyse, clarte de la formulation.

COUNCIL_MIN_RESPONSES=3
COUNCIL_FALLBACK_POOL=deepseek/deepseek-chat-v3.1:free,qwen/qwen3-235b-a22b:free,openrouter/free,openrouter/free

CHAIRMAN_ANALYSIS_ENABLED=true
DAILY_QUOTA_QUESTIONS=100

REQUEST_TIMEOUT=180000
TITLE_TIMEOUT=30000
MAX_RETRIES=3
RETRY_BASE_DELAY=1500

DATA_DIR=data/conversations

HOST=127.0.0.1
PORT=__APP_PORT__
LOG_LEVEL=info
NODE_ENV=production

CORS_ORIGINS=https://$FQDN

# v2.8 -- Auth mono-user (admin legacy)
ADMIN_USERNAME=admin
SESSION_DURATION_DAYS=30

# v2.16 -- Multi-user
SESSION_SECRET=$SESSION_SECRET
OPENROUTER_KEYS_SECRET=$KEYS_SECRET
PASSWORD_MIN_LENGTH=8
USERS_FILE=data/users.json
LEADERBOARD_FILE=data/leaderboard.json
ENVEOF

chmod 600 "$REMOTE_DIR/.env"
echo "[OK] .env cree avec permissions 600 (secrets generes via openssl)"

pm2 delete __PM2_NAME__ 2>/dev/null || true
cd "$REMOTE_DIR"
pm2 start ecosystem.config.cjs
pm2 save > /dev/null
sleep 3

echo "==> Health check apres demarrage avec .env complet"
HTTP=$(curl -s -o /tmp/health.json -w "%{http_code}" "http://localhost:__APP_PORT__/health" || echo "000")
echo "HTTP: $HTTP"
if [ "$HTTP" = "200" ]; then
  echo "[OK] Backend repond sur le port __APP_PORT__"
else
  echo "[FAIL] Backend NE repond PAS. Logs PM2 :"
  pm2 logs __PM2_NAME__ --lines 30 --nostream
  exit 1
fi
'@

    $bash = $bashTemplate `
        -replace '__REMOTE_DIR__', $REMOTE_DIR `
        -replace '__API_KEY__',    $apiKey `
        -replace '__FQDN__',       $FQDN `
        -replace '__APP_PORT__',   $APP_PORT `
        -replace '__PM2_NAME__',   $PM2_NAME

    $rc = Invoke-SshBashScript $cfg $bash
    if ($rc -ne 0) { throw "Initialisation .env a echoue" }
    Write-Ok ".env initialise et PM2 redemarre"
}

# -----------------------------------------------------------------------------
# Nginx vhost
# -----------------------------------------------------------------------------
function Invoke-NginxSetup {
    param($cfg)
    if ($SkipNginx) { Write-Step "Nginx (SKIP)"; return }
    Write-Step "Configuration Nginx"

    $bashTemplate = @'
set -e
FQDN=__FQDN__
APP_PORT=__APP_PORT__
REMOTE_DIR=__REMOTE_DIR__
VHOST_PATH=/etc/nginx/sites-available/$FQDN.conf

sudo tee "$VHOST_PATH" > /dev/null <<NGINXEOF
server {
    listen 80;
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

    # --- SSE streaming : buffering OFF, timeout long ---
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

    # --- Landing page sur la racine exacte (v2.8) ---
    location = / {
        try_files /landing.html =404;
    }

    # --- SPA fallback (app React + page Login) ---
    location / {
        try_files \$uri \$uri/ /index.html;
    }
}
NGINXEOF

sudo ln -sf "$VHOST_PATH" "/etc/nginx/sites-enabled/$FQDN.conf"

echo "[..] chmod : autoriser Nginx (www-data) a traverser /home/ubuntu"
sudo chmod o+x /home/ubuntu
sudo chmod -R o+rX "__REMOTE_DIR__/frontend/dist"
echo "[OK] permissions frontend/dist OK pour Nginx"

echo "[..] nginx -t"
sudo nginx -t
sudo systemctl reload nginx
echo "[OK] Nginx vhost actif pour $FQDN"
'@

    $bash = $bashTemplate `
        -replace '__FQDN__',       $FQDN `
        -replace '__APP_PORT__',   $APP_PORT `
        -replace '__REMOTE_DIR__', $REMOTE_DIR

    $rc = Invoke-SshBashScript $cfg $bash
    if ($rc -ne 0) { throw "Config Nginx a echoue" }
    Write-Ok "Nginx configure"
}

# -----------------------------------------------------------------------------
# Certbot SSL
# -----------------------------------------------------------------------------
function Invoke-Certbot {
    param($cfg)
    if ($SkipCertbot) { Write-Step "Certbot (SKIP)"; return }
    Write-Step "Obtention certificat SSL Let's Encrypt"

    $email = Read-Host "Email pour Let's Encrypt"
    if ([string]::IsNullOrWhiteSpace($email)) {
        Write-Warn "Email vide, certbot saute"
        return
    }

    $bashTemplate = @'
set -e
FQDN=__FQDN__
EMAIL=__EMAIL__

sudo certbot --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --redirect \
    -d "$FQDN"

echo "[OK] SSL configure pour $FQDN"
'@

    $bash = $bashTemplate `
        -replace '__FQDN__',  $FQDN `
        -replace '__EMAIL__', $email

    $rc = Invoke-SshBashScript $cfg $bash
    if ($rc -ne 0) { Write-Warn "Certbot a renvoye une erreur (verifier DNS du sous-domaine)" }
    else { Write-Ok "HTTPS actif sur https://$FQDN" }
}

# -----------------------------------------------------------------------------
# Logs post-deploy
# -----------------------------------------------------------------------------
function Show-PostDeployLogs {
    param($cfg)
    if (-not $LogsAfter) { return }
    Write-Step "Logs PM2"
    Invoke-SshCommand $cfg "pm2 logs $PM2_NAME --lines 30 --nostream"
}

# =============================================================================
# MAIN
# =============================================================================
Show-Banner

$cfg = Get-DeployConfig
Test-SshConnection $cfg

Build-Frontend
$zipPath = New-DeployPackage
Send-DeployPackage $cfg $zipPath

if ($Init) {
    Install-VpsPrerequisites $cfg
    Invoke-CodeDeploy $cfg -SkipPm2
    Initialize-RemoteEnv $cfg
    Invoke-NginxSetup $cfg
    Invoke-Certbot $cfg
} else {
    Invoke-CodeDeploy $cfg

    if ($UpdateNginx) {
        Invoke-NginxSetup $cfg
    }
}

Show-PostDeployLogs $cfg

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  DEPLOY OK" -ForegroundColor Green
Write-Host "  URL : https://$FQDN" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Diagnostic :" -ForegroundColor Gray
Write-Host "  ssh $($cfg.user)@$($cfg.host) 'pm2 status'"
Write-Host "  ssh $($cfg.user)@$($cfg.host) 'pm2 logs $PM2_NAME --lines 30 --nostream'"
Write-Host "  curl https://$FQDN/health"
Write-Host ""
