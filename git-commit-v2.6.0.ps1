# git-commit-v2.6.0.ps1
# Premier commit + tag v2.6.0 + push GitHub pour llm-council-node
# Usage : powershell -ExecutionPolicy Bypass -File .\git-commit-v2.6.0.ps1

$ProjectDir = "C:\Agile\llm-council-node"
$Remote     = "https://github.com/jlp4keritec/council.git"
$Branch     = "main"
$Tag        = "v2.6.0"
$Message    = "v2.6.0 - LLM Council Node initial release

- Pipeline 3 stages (opinions, peer ranking, chairman synthesis) via OpenRouter
- Modal Configuration : selecteur modeles + test disponibilite + presets free/premium
- Stage 1 avec fallback automatique sur pool configurable (min 3 avis garanti)
- Chairman avec cascade fallback et analyse meta-cognitive (2 onglets) + toggle on/off
- Exports JSON / Markdown / Word (.docx) / PowerPoint (.pptx)
- Sidebar 20 slots fixes + quota visuel + page d'aide quota OpenRouter
- Scripts start/stop/backup (.ps1 + .bat)
- Deploy script VPS conforme skill deploy-vps (port 5706, council.mesoutilsagile.com)"

Set-Location $ProjectDir

# -----------------------------------------------------------------
# 0. Init Git si premier coup (pas de .git existant)
# -----------------------------------------------------------------
if (-not (Test-Path ".\.git")) {
    Write-Host "[INIT] .git absent -- initialisation du repo" -ForegroundColor Yellow
    git init -b $Branch
    git remote add origin $Remote
    Write-Host "[OK] Repo init, remote origin = $Remote" -ForegroundColor Green
} else {
    # Verifie que le remote est bien le bon
    $currentRemote = (git remote get-url origin 2>$null)
    if ($currentRemote -ne $Remote) {
        Write-Host "[!!] Remote origin different :" -ForegroundColor Yellow
        Write-Host "     actuel  = $currentRemote"
        Write-Host "     attendu = $Remote"
        $rep = Read-Host "Mettre a jour le remote ? (o/N)"
        if ($rep -eq "o" -or $rep -eq "O") {
            if ($currentRemote) {
                git remote set-url origin $Remote
            } else {
                git remote add origin $Remote
            }
            Write-Host "[OK] Remote mis a jour" -ForegroundColor Green
        }
    }
}

# -----------------------------------------------------------------
# 1. AUDIT : fichiers sensibles deja traces dans git
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[AUDIT] Recherche de fichiers sensibles deja traces..." -ForegroundColor Yellow

$tracked = git ls-files
$dangerPatterns = @(
    '\.env$',                           # secret API key
    '\.env\.[^e]',                      # autres .env (sauf .env.example)
    'data[/\\]conversations[/\\]',      # conversations users (PII potentiel)
    'data[/\\].*\.db$',
    'data[/\\].*\.db-wal$',
    'data[/\\].*\.db-shm$',
    'data[/\\].*\.bak',
    'node_modules[/\\]',
    'deploy-config\.json$',             # clef SSH + creds VPS
    '\.tar\.gz$',
    '\.zip$',                            # archives ZIP (ex: backup local)
    'logs[/\\]',
    ' - Copie\.'
)

$dangerFiles = @()
foreach ($pattern in $dangerPatterns) {
    $found = $tracked | Where-Object { $_ -match $pattern }
    if ($found) { $dangerFiles += $found }
}

if ($dangerFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "[!!! ALERTE !!!] $($dangerFiles.Count) fichier(s) sensible(s) deja trace(s) :" -ForegroundColor Red
    $dangerFiles | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "Commandes pour les retirer du tracking (sans les supprimer du disque) :" -ForegroundColor Yellow
    foreach ($f in $dangerFiles) {
        Write-Host "    git rm --cached `"$f`"" -ForegroundColor Cyan
    }
    Write-Host ""
    Write-Host "Puis relance ce script. Abandon." -ForegroundColor Yellow
    exit 1
} else {
    Write-Host "[OK] Aucun fichier sensible trace." -ForegroundColor Green
}

# -----------------------------------------------------------------
# 2. Verification fichiers attendus pour la v2.6.0
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Verification des fichiers attendus" -ForegroundColor Yellow

$expectedFiles = @(
    @{Path="backend\server.js";                              Cat="Backend Fastify"},
    @{Path="backend\council.js";                             Cat="Pipeline 3 stages"},
    @{Path="backend\openrouter.js";                          Cat="Client OpenRouter + retry"},
    @{Path="backend\exporters.js";                           Cat="Exports MD/JSON/DOCX/PPTX"},
    @{Path="backend\prompts.js";                             Cat="Prompts FR Stage 2/3"},
    @{Path="backend\pricing.js";                             Cat="Tracking usage/cout"},
    @{Path="backend\storage.js";                             Cat="JSON storage atomique"},
    @{Path="backend\config.js";                              Cat="Config env vars"},
    @{Path="frontend\src\App.jsx";                           Cat="Frontend root"},
    @{Path="frontend\src\components\ChatInterface.jsx";      Cat="Pipeline UI"},
    @{Path="frontend\src\components\ModelSelector.jsx";      Cat="Modal configuration"},
    @{Path="frontend\src\components\Sidebar.jsx";            Cat="Sidebar 20 slots + quota"},
    @{Path="frontend\src\components\QuotaHelp.jsx";          Cat="Page aide quota"},
    @{Path="frontend\src\components\Stage1.jsx";             Cat="Onglets opinions"},
    @{Path="frontend\src\components\Stage2.jsx";             Cat="Ranking pairs"},
    @{Path="frontend\src\components\Stage3.jsx";             Cat="Synthese + analyse"},
    @{Path="frontend\src\index.css";                         Cat="Styles"},
    @{Path="package.json";                                   Cat="Deps root"},
    @{Path="frontend\package.json";                          Cat="Deps frontend"},
    @{Path="ecosystem.config.cjs";                           Cat="PM2 config"},
    @{Path="deploy-council.ps1";                             Cat="Deploy VPS"},
    @{Path="start.ps1";                                      Cat="Start local"},
    @{Path="start.bat";                                      Cat="Start local (BAT)"},
    @{Path="stop.ps1";                                       Cat="Stop local"},
    @{Path="stop.bat";                                       Cat="Stop local (BAT)"},
    @{Path="backup-llm-council-node.ps1";                    Cat="Backup ZIP"},
    @{Path="backup-llm-council-node.bat";                    Cat="Backup (BAT)"},
    @{Path=".env.example";                                   Cat="Template config payant"},
    @{Path=".env.example.free";                              Cat="Template config free"},
    @{Path=".gitignore";                                     Cat="Exclusions Git"},
    @{Path="README.md";                                      Cat="Doc"}
)

$missing = $false
foreach ($f in $expectedFiles) {
    $path = Join-Path $ProjectDir $f.Path
    if (Test-Path $path) {
        $sizeKb = [math]::Round(((Get-Item $path).Length / 1KB), 1)
        Write-Host "    [v] [$($f.Cat)] $($f.Path) ($sizeKb Ko)" -ForegroundColor Green
    } else {
        Write-Host "    [X] [$($f.Cat)] $($f.Path) MANQUANT" -ForegroundColor Red
        $missing = $true
    }
}
if ($missing) {
    Write-Host "[FAIL] Fichiers manquants. Abandon." -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------
# 3. Garde-fou taille (rien au-dessus de 5 Mo a part exception explicite)
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Verification taille des fichiers (max 5 Mo)" -ForegroundColor Yellow

# Scan recursif des fichiers > 5 Mo qui seraient stages
$bigFiles = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue | Where-Object {
    $_.Length -gt 5MB -and
    $_.FullName -notmatch '\\node_modules\\' -and
    $_.FullName -notmatch '\\\.git\\' -and
    $_.FullName -notmatch '\\dist\\' -and
    $_.FullName -notmatch '\\\.vite\\' -and
    $_.FullName -notmatch '\\data\\'
}

if ($bigFiles) {
    Write-Host "[X] Fichier(s) > 5 Mo detecte(s) :" -ForegroundColor Red
    foreach ($bf in $bigFiles) {
        $mb = [math]::Round($bf.Length / 1MB, 2)
        Write-Host "    $($bf.FullName.Substring($ProjectDir.Length + 1)) = $mb Mo" -ForegroundColor Red
    }
    Write-Host "[FAIL] Verifie ces fichiers avant push (ajoute au .gitignore si necessaire). Abandon." -ForegroundColor Red
    exit 1
}
Write-Host "    [OK] Aucun fichier > 5 Mo." -ForegroundColor Green

# -----------------------------------------------------------------
# 4. Status pre-commit
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] git status (avant add)" -ForegroundColor Yellow
git status --short

# -----------------------------------------------------------------
# 5. Add + commit
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] git add -A + commit" -ForegroundColor Yellow
git add -A

$staged = git diff --cached --stat 2>$null
if (-not $staged) {
    # Premier commit sur repo vide : diff --cached ne marche pas, on regarde ls-files
    $stagedList = git diff --cached --name-only 2>$null
    if (-not $stagedList) {
        Write-Host "[INFO] Rien a commit. Abandon." -ForegroundColor DarkGray
        exit 0
    }
}

Write-Host ""
Write-Host "$staged" -ForegroundColor DarkGray
Write-Host ""

git commit -m $Message
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] commit a echoue (deja committe ou rien a commit ?)" -ForegroundColor Red
    exit 1
}

# -----------------------------------------------------------------
# 6. Tag SemVer
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] Creation du tag $Tag" -ForegroundColor Yellow
$existingTag = git tag -l $Tag
if ($existingTag) {
    Write-Host "[!!] Tag $Tag existe deja, on saute la creation" -ForegroundColor Yellow
} else {
    git tag -a $Tag -m "$Tag - First production release"
    Write-Host "[OK] Tag $Tag cree" -ForegroundColor Green
}

# -----------------------------------------------------------------
# 7. Push branche + tag
# -----------------------------------------------------------------
Write-Host ""
Write-Host "[STEP] git push -u origin $Branch" -ForegroundColor Yellow
git push -u origin $Branch
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] push branche echoue. Verifie les credentials GitHub (Personal Access Token)." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "[STEP] git push origin $Tag" -ForegroundColor Yellow
git push origin $Tag
if ($LASTEXITCODE -ne 0) {
    Write-Host "[!!] push du tag a echoue (mais le commit est passe)" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "[OK] Push termine vers $Remote" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host "     Branche : $Branch"
Write-Host "     Tag     : $Tag"
Write-Host "     Repo    : $Remote"
Write-Host ""
Write-Host "ETAPE SUIVANTE :" -ForegroundColor Cyan
Write-Host "    .\deploy-council.ps1 -Init     # premier deploiement VPS"
Write-Host ""
