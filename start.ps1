# =============================================================================
# start.ps1 -- Demarrage local du LLM Council sur Windows
# =============================================================================
# Lance le backend Fastify et le frontend Vite dans deux fenetres
# PowerShell separees pour pouvoir voir les logs de chaque service.
#
# Pre-requis :
#   - Node.js >= 20 (verifier : node --version)
#   - .env present a la racine avec OPENROUTER_API_KEY
#
# Usage :
#   .\start.ps1
#   .\start.ps1 -SkipInstall    # saute npm install (si deja fait)
# =============================================================================

param(
    [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
$ProjectRoot = $PSScriptRoot

function Write-Step { param($m) Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] >> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "   OK  $m"     -ForegroundColor Green }
function Write-Info { param($m) Write-Host "   ... $m"     -ForegroundColor Gray }
function Write-Warn { param($m) Write-Host "   !!  $m"     -ForegroundColor Yellow }
function Write-Fail { param($m) Write-Host "   ERREUR $m"  -ForegroundColor Red }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  LLM Council -- Local Dev" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Verif Node
try {
    $nodeVersion = & node --version 2>$null
    Write-Info "Node detecte : $nodeVersion"
} catch {
    Write-Fail "Node.js non installe ou pas dans le PATH"
    Write-Host "   Telecharge sur https://nodejs.org (version 20 LTS recommandee)"
    exit 1
}

# Verif .env
$envPath = Join-Path $ProjectRoot ".env"
if (-not (Test-Path $envPath)) {
    Write-Fail ".env introuvable a la racine du projet"
    Write-Host ""
    Write-Host "   Pour le mode gratuit (recommande pour debuter) :"
    Write-Host "      cp .env.example.free .env"
    Write-Host "   Pour le mode payant :"
    Write-Host "      cp .env.example .env"
    Write-Host ""
    Write-Host "   Puis edite .env pour mettre ta cle OPENROUTER_API_KEY"
    exit 1
}

# Verif que la cle API est presente dans .env
$envContent = Get-Content $envPath -Raw
if ($envContent -notmatch 'OPENROUTER_API_KEY=sk-or-') {
    Write-Warn "OPENROUTER_API_KEY semble manquante ou pas remplie dans .env"
    Write-Host "   Va sur https://openrouter.ai/keys pour generer une cle (gratuit)"
    $continue = Read-Host "Continuer quand meme ? (o/N)"
    if ($continue -ne "o" -and $continue -ne "O") {
        exit 1
    }
}

# Install backend deps
if (-not $SkipInstall) {
    if (-not (Test-Path (Join-Path $ProjectRoot "node_modules"))) {
        Write-Step "Installation des deps backend (npm install)"
        Push-Location $ProjectRoot
        try {
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm install backend a echoue" }
            Write-Ok "Backend installe"
        }
        finally { Pop-Location }
    } else {
        Write-Info "node_modules backend deja present (utiliser -SkipInstall pour zapper la verif)"
    }

    # Install frontend deps
    $frontendDir = Join-Path $ProjectRoot "frontend"
    if (-not (Test-Path (Join-Path $frontendDir "node_modules"))) {
        Write-Step "Installation des deps frontend (npm install)"
        Push-Location $frontendDir
        try {
            & npm install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm install frontend a echoue" }
            Write-Ok "Frontend installe"
        }
        finally { Pop-Location }
    } else {
        Write-Info "node_modules frontend deja present"
    }
}

# Lance les deux services dans des fenetres separees
Write-Step "Demarrage du backend (nouvelle fenetre)"
$backendCmd = "Set-Location '$ProjectRoot'; node backend/server.js; Write-Host ''; Write-Host 'Backend stoppe. Appuie sur une touche pour fermer...' -ForegroundColor Yellow; [Console]::ReadKey() | Out-Null"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd
Write-Ok "Backend en cours de demarrage sur http://localhost:8001"

Start-Sleep -Seconds 2

Write-Step "Demarrage du frontend (nouvelle fenetre)"
$frontendCmd = "Set-Location '$ProjectRoot\frontend'; npm run dev; Write-Host ''; Write-Host 'Frontend stoppe. Appuie sur une touche pour fermer...' -ForegroundColor Yellow; [Console]::ReadKey() | Out-Null"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd
Write-Ok "Frontend en cours de demarrage sur http://localhost:5180"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  LLM Council demarre" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend  : http://localhost:8001"
Write-Host "  Frontend : http://localhost:5180  <-- ouvre dans le navigateur"
Write-Host ""
Write-Host "Les deux services tournent dans des fenetres PowerShell separees."
Write-Host "Ferme-les pour stopper les services (Ctrl+C dedans, ou croix de la fenetre)."
Write-Host ""
