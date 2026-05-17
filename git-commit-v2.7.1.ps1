# =============================================================================
# git-commit-v2.7.1.ps1  --  Commit + tag + push pour LLM Council v2.7.1
# =============================================================================
#
# Changements depuis v2.6.0 :
#   - NEW    backend/quota.js              : detection dynamique du quota OpenRouter
#   - EDIT   backend/server.js             : /api/usage enrichi + /api/usage/refresh
#   - EDIT   frontend/src/components/Sidebar.jsx : 4 modes affichage + bouton refresh
#   - EDIT   frontend/src/index.css        : styles badges quota
#   - FIX    quota.js v2.7.1               : detection corrigee (au moins un :free)
#
# Stack : PowerShell 5.1 Windows, ASCII pur dans les strings (skill powershell-bash-escapes)
# =============================================================================

$ErrorActionPreference = 'Stop'
$ProjectRoot = $PSScriptRoot
$Tag         = "v2.7.1"
$Message     = @"
v2.7.1 - Quota dynamique OpenRouter

Detection automatique du quota journalier selon :
- Council actif (council_models + chairman + title, avec override localStorage)
- Statut OpenRouter /api/v1/auth/key (cache 1h backend)
- Presence d au moins un modele :free dans la config

Affichage sidebar adaptatif :
- Free sans credit (is_free_tier=true)     -> barre X / 5
- Free avec 10\$ deposes (is_free_tier=false) -> barre X / 100
- 100% modeles payants                     -> compteur sans barre
- Statut OpenRouter inconnu                -> fallback prudent X / 5

Nouveaux endpoints backend :
- GET  /api/usage              -> retourne struct quota.mode + retro-compat
- POST /api/usage/refresh      -> invalide cache /auth/key (apres depot credit)

Fix v2.7.1 : detection "MODE PAYANT" se declenchait abusivement des qu un seul
modele payant etait present dans le council, alors meme que les :free presents
continuaient a consommer la quota free-per-day OpenRouter. Corrige : au moins
un :free => application du quota free.

Fichiers modifies :
- backend/quota.js              [NEW]
- backend/server.js             [EDIT]
- frontend/src/components/Sidebar.jsx [EDIT]
- frontend/src/index.css        [EDIT]
"@

Set-Location $ProjectRoot

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------

function Write-Section($title) {
    Write-Host ""
    Write-Host "==> $title" -ForegroundColor Cyan
}

function Write-OK($msg)     { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)   { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail($msg)   { Write-Host "    [FAIL] $msg" -ForegroundColor Red }

function Test-CommandExists($cmd) {
    return $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

# -----------------------------------------------------------------------------
# Etape 0 - Pre-requis
# -----------------------------------------------------------------------------

Write-Section "Etape 0 : Verification des pre-requis"

if (-not (Test-CommandExists git)) {
    Write-Fail "git introuvable dans le PATH. Installe Git for Windows : https://git-scm.com/"
    exit 1
}
Write-OK "git present"

if (-not (Test-Path .git)) {
    Write-Warn "Repo git non initialise dans $ProjectRoot"
    $init = Read-Host "    Initialiser maintenant ? (o/N)"
    if ($init -ne 'o' -and $init -ne 'O') {
        Write-Fail "Abandon."
        exit 1
    }
    & git init -b main | Out-Host
    Write-OK "git init -b main"
    $remoteUrl = Read-Host "    URL du remote origin (ex: https://github.com/jlp4keritec/council.git, vide pour skip)"
    if ($remoteUrl) {
        & git remote add origin $remoteUrl | Out-Host
        Write-OK "remote origin ajoute : $remoteUrl"
    }
} else {
    Write-OK "repo git initialise"
}

# Verifier l existence des fichiers v2.7
$v27Files = @(
    'backend\quota.js',
    'backend\server.js',
    'frontend\src\components\Sidebar.jsx',
    'frontend\src\index.css'
)

$missing = @()
foreach ($f in $v27Files) {
    if (-not (Test-Path $f)) {
        $missing += $f
    }
}

if ($missing.Count -gt 0) {
    Write-Fail "Fichiers v2.7 manquants :"
    $missing | ForEach-Object { Write-Host "      - $_" -ForegroundColor Red }
    Write-Fail "Re-applique le ZIP v2.7 + le fix quota.js v2.7.1 avant de committer."
    exit 1
}
Write-OK "4 fichiers v2.7 presents sur disque"

# -----------------------------------------------------------------------------
# Etape 1 - Audit securite (fichiers sensibles)
# -----------------------------------------------------------------------------

Write-Section "Etape 1 : Audit securite des fichiers staged + worktree"

# Patterns interdits dans le commit
$forbiddenPatterns = @(
    '\.env$',
    '\.env\.local$',
    '^data/conversations/',
    '^node_modules/',
    '^frontend/node_modules/',
    '^deploy-config\.json$',
    '\.tar\.gz$',
    '\.zip$',
    '^logs/',
    ' - Copie\.',
    '\.bak$'
)

$tracked = & git ls-files 2>$null
$badTracked = @()
foreach ($file in $tracked) {
    foreach ($pat in $forbiddenPatterns) {
        if ($file -match $pat) {
            $badTracked += $file
            break
        }
    }
}

if ($badTracked.Count -gt 0) {
    Write-Fail "Fichiers sensibles deja tracked dans git :"
    $badTracked | ForEach-Object { Write-Host "      - $_" -ForegroundColor Red }
    Write-Host ""
    Write-Host "    Commandes pour les retirer du tracking (les fichiers locaux sont preserves) :" -ForegroundColor Yellow
    $badTracked | ForEach-Object { Write-Host "      git rm --cached `"$_`"" -ForegroundColor Yellow }
    Write-Host ""
    Write-Fail "Corrige puis relance le script."
    exit 1
}
Write-OK "Aucun fichier sensible dans le tracking"

# Verifier que .gitignore exclut bien le sensible
if (Test-Path .gitignore) {
    $gitignore = Get-Content .gitignore -Raw
    $expectedIgnore = @('.env', 'node_modules', 'data/conversations', 'deploy-config.json', 'dist', '.vite')
    $missingIgnore = @()
    foreach ($pat in $expectedIgnore) {
        if ($gitignore -notmatch [regex]::Escape($pat)) {
            $missingIgnore += $pat
        }
    }
    if ($missingIgnore.Count -gt 0) {
        Write-Warn ".gitignore manque ces patterns : $($missingIgnore -join ', ')"
    } else {
        Write-OK ".gitignore couvre les patterns critiques"
    }
} else {
    Write-Warn "Pas de .gitignore detecte"
}

# -----------------------------------------------------------------------------
# Etape 2 - Garde-fou taille des fichiers
# -----------------------------------------------------------------------------

Write-Section "Etape 2 : Garde-fou taille (max 5 MB par fichier)"

$maxSize = 5MB
$bigFiles = @()
$excludeDirs = @('node_modules', '.git', 'dist', '.vite', 'data')

Get-ChildItem -Recurse -File | Where-Object {
    $relativePath = $_.FullName.Substring($ProjectRoot.Length + 1)
    $skip = $false
    foreach ($exc in $excludeDirs) {
        if ($relativePath -like "$exc\*" -or $relativePath -like "*\$exc\*") {
            $skip = $true
            break
        }
    }
    -not $skip -and $_.Length -gt $maxSize
} | ForEach-Object {
    $bigFiles += [PSCustomObject]@{
        Path = $_.FullName.Substring($ProjectRoot.Length + 1)
        SizeMB = [math]::Round($_.Length / 1MB, 2)
    }
}

if ($bigFiles.Count -gt 0) {
    Write-Fail "Fichiers > 5 MB detectes (a exclure du commit) :"
    $bigFiles | ForEach-Object { Write-Host "      - $($_.Path) ($($_.SizeMB) MB)" -ForegroundColor Red }
    Write-Fail "Ajoute-les a .gitignore puis relance."
    exit 1
}
Write-OK "Aucun fichier > 5 MB"

# -----------------------------------------------------------------------------
# Etape 3 - Bump version dans package.json
# -----------------------------------------------------------------------------

Write-Section "Etape 3 : Bump version package.json vers $Tag"

$pkgPath = Join-Path $ProjectRoot 'package.json'
if (Test-Path $pkgPath) {
    $content = Get-Content $pkgPath -Raw
    $newVersion = $Tag -replace '^v', ''
    $updated = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
    if ($updated -ne $content) {
        Set-Content -Path $pkgPath -Value $updated -NoNewline
        Write-OK "package.json -> $newVersion"
    } else {
        Write-Warn "package.json deja en version $newVersion (ou pattern non trouve)"
    }
} else {
    Write-Warn "package.json absent a la racine, skip"
}

# Bump aussi frontend/package.json si present
$frontendPkg = Join-Path $ProjectRoot 'frontend\package.json'
if (Test-Path $frontendPkg) {
    $content = Get-Content $frontendPkg -Raw
    $newVersion = $Tag -replace '^v', ''
    $updated = $content -replace '"version":\s*"[^"]+"', "`"version`": `"$newVersion`""
    if ($updated -ne $content) {
        Set-Content -Path $frontendPkg -Value $updated -NoNewline
        Write-OK "frontend/package.json -> $newVersion"
    }
}

# -----------------------------------------------------------------------------
# Etape 4 - Visualisation des changements
# -----------------------------------------------------------------------------

Write-Section "Etape 4 : git status (changements a committer)"

& git status --short | Out-Host
Write-Host ""

$confirm = Read-Host "    Tout est OK ? Continuer le commit ? (o/N)"
if ($confirm -ne 'o' -and $confirm -ne 'O') {
    Write-Warn "Abandon par l utilisateur. Aucun commit cree."
    exit 0
}

# -----------------------------------------------------------------------------
# Etape 5 - git add + commit
# -----------------------------------------------------------------------------

Write-Section "Etape 5 : git add + commit"

& git add -A | Out-Host
if ($LASTEXITCODE -ne 0) {
    Write-Fail "git add a echoue (code $LASTEXITCODE)"
    exit 1
}
Write-OK "git add -A"

# Ecrire le message dans un fichier temp pour eviter les pieges d echappement
$msgFile = New-TemporaryFile
Set-Content -Path $msgFile -Value $Message -Encoding UTF8

& git commit -F $msgFile.FullName | Out-Host
$commitCode = $LASTEXITCODE
Remove-Item $msgFile -Force -ErrorAction SilentlyContinue

if ($commitCode -ne 0) {
    Write-Fail "git commit a echoue (code $commitCode)"
    Write-Warn "Si le message est 'nothing to commit', c est que tu as deja committe ces changements."
    exit 1
}
Write-OK "Commit cree"

# -----------------------------------------------------------------------------
# Etape 6 - Tag annote
# -----------------------------------------------------------------------------

Write-Section "Etape 6 : Tag annote $Tag"

# Verifier si le tag existe deja
$existingTag = & git tag -l $Tag
if ($existingTag) {
    Write-Warn "Le tag $Tag existe deja localement"
    $retag = Read-Host "    Le supprimer et le recreer ? (o/N)"
    if ($retag -eq 'o' -or $retag -eq 'O') {
        & git tag -d $Tag | Out-Host
        Write-OK "Tag local supprime"
    } else {
        Write-Warn "Tag conserve, skip de la recreation"
    }
}

if (-not (& git tag -l $Tag)) {
    & git tag -a $Tag -m "Release $Tag - Quota dynamique OpenRouter" | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "git tag a echoue (code $LASTEXITCODE)"
        exit 1
    }
    Write-OK "Tag $Tag cree"
}

# -----------------------------------------------------------------------------
# Etape 7 - Push branche + tag
# -----------------------------------------------------------------------------

Write-Section "Etape 7 : git push origin main + tag"

# Verifier qu un remote existe
$hasRemote = & git remote 2>$null
if (-not $hasRemote) {
    Write-Warn "Aucun remote configure"
    Write-Host "    Commit + tag locaux faits. Configure ton remote puis push manuellement :" -ForegroundColor Yellow
    Write-Host "      git remote add origin <URL>" -ForegroundColor Yellow
    Write-Host "      git push -u origin main" -ForegroundColor Yellow
    Write-Host "      git push origin $Tag" -ForegroundColor Yellow
    exit 0
}

$pushBranch = Read-Host "    Push origin main maintenant ? (o/N)"
if ($pushBranch -eq 'o' -or $pushBranch -eq 'O') {
    & git push -u origin main | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "git push origin main a echoue (code $LASTEXITCODE)"
        exit 1
    }
    Write-OK "main push"

    & git push origin $Tag | Out-Host
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "git push tag a echoue (code $LASTEXITCODE)"
        exit 1
    }
    Write-OK "Tag $Tag push"
} else {
    Write-Warn "Push skippe. Pour push manuellement plus tard :"
    Write-Host "      git push -u origin main" -ForegroundColor Yellow
    Write-Host "      git push origin $Tag" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# Resume final
# -----------------------------------------------------------------------------

Write-Section "Termine"

$remoteUrl = & git remote get-url origin 2>$null
Write-Host ""
Write-Host "    [OK] Commit + tag $Tag crees" -ForegroundColor Green
if ($remoteUrl) {
    Write-Host "    [OK] Push vers : $remoteUrl" -ForegroundColor Green
}
Write-Host ""
Write-Host "    ETAPE SUIVANTE -- DEPLOIEMENT VPS :" -ForegroundColor Cyan
Write-Host "        .\deploy-council.ps1" -ForegroundColor Cyan
Write-Host ""
