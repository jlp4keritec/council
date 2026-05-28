# =============================================================================
# audit-precommit-council.ps1 -- Audit pre-commit du projet llm-council
# =============================================================================
# A lancer depuis la racine du projet (C:\Agile\llm-council-node\) AVANT
# tout commit/tag/push. Verifie qu'on ne commite rien de sensible.
#
# Conventions respectees (cf. skill deploy-vps, section "Audit pre-deploiement") :
#   1. .gitignore couvre les sensibles
#   2. Aucun fichier sensible n'est staged
#   3. Aucune cle API en dur dans le code
#   4. Aucun fichier > 10 MB (alerte rouge si > 50 MB)
#   5. Taille totale des modifs raisonnable
#
# Usage :
#   .\audit-precommit-council.ps1
# =============================================================================

$ErrorActionPreference = "Continue"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  AUDIT PRE-COMMIT LLM Council" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# 1. .gitignore : verifications critiques
# -----------------------------------------------------------------------------
Write-Host "`n=== 1. .gitignore : exclusions critiques ===" -ForegroundColor Cyan
$ko1 = 0
if (-not (Test-Path .gitignore)) {
    Write-Host "  ERREUR .gitignore introuvable !" -ForegroundColor Red
    $ko1 = 1
} else {
    $gi = Get-Content .gitignore -Raw
    foreach ($p in @('.env', 'node_modules', 'data/', '*.db', 'deploy-config.json', '*.zip', '.env.*')) {
        if ($gi -match [regex]::Escape($p)) {
            Write-Host "  OK   $p exclu" -ForegroundColor Green
        } else {
            Write-Host "  WARN $p NON exclu" -ForegroundColor Red
            $ko1 = 1
        }
    }
}

# -----------------------------------------------------------------------------
# 2. Fichiers sensibles staged ou untracked (doit etre VIDE)
# -----------------------------------------------------------------------------
Write-Host "`n=== 2. Fichiers sensibles dans git status ===" -ForegroundColor Cyan
$status = git status --porcelain
$bad = $status | Where-Object {
    $_ -match '\.env(\s|$)|\\\.env|/\.env|/data/|data\\|\.db(\s|$)|deploy-config\.json|node_modules' -and
    $_ -notmatch '\.env\.example' -and
    $_ -notmatch '\.envEXAMPLE'
}
if ($bad) {
    Write-Host "  KO !! Fichiers sensibles detectes :" -ForegroundColor Red
    $bad | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
} else {
    Write-Host "  OK (rien de sensible)" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 3. Cles API en dur dans le code
# -----------------------------------------------------------------------------
Write-Host "`n=== 3. Cles API / secrets en dur dans le code source ===" -ForegroundColor Cyan
$hits = $null
if (Test-Path backend) {
    $hits = Get-ChildItem backend -Recurse -File -Include *.js -ErrorAction SilentlyContinue |
            Select-String -Pattern 'sk-or-v1-[a-zA-Z0-9]{20,}','sk-ant-[a-zA-Z0-9]{20,}','OPENROUTER_API_KEY\s*=\s*"sk-' -List
}
if (Test-Path frontend/src) {
    $hits2 = Get-ChildItem frontend/src -Recurse -File -Include *.js,*.jsx -ErrorAction SilentlyContinue |
             Select-String -Pattern 'sk-or-v1-[a-zA-Z0-9]{20,}','sk-ant-[a-zA-Z0-9]{20,}' -List
    if ($hits2) { $hits = @($hits) + @($hits2) }
}
if ($hits) {
    Write-Host "  KO !! Cles trouvees en dur :" -ForegroundColor Red
    $hits | ForEach-Object { Write-Host "    $($_.Path):$($_.LineNumber) -> $($_.Line.Trim())" -ForegroundColor Red }
} else {
    Write-Host "  OK (aucune cle en dur)" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 4. Fichiers volumineux (alerte > 10 MB, ko > 50 MB)
# -----------------------------------------------------------------------------
Write-Host "`n=== 4. Fichiers > 10 MB (KO si > 50 MB) ===" -ForegroundColor Cyan
$big = Get-ChildItem -Recurse -File -ErrorAction SilentlyContinue |
       Where-Object {
           $_.FullName -notmatch '\\node_modules\\|\\\.git\\|\\data\\|\\dist\\|\\build\\|\\\.vite\\' -and
           $_.Length -gt 10MB
       } |
       Sort-Object Length -Descending
if ($big) {
    foreach ($f in $big) {
        $mb = [math]::Round($f.Length / 1MB, 1)
        $col = if ($mb -gt 50) { 'Red' } elseif ($mb -gt 20) { 'Yellow' } else { 'White' }
        $tag = if ($mb -gt 50) { 'KO  ' } elseif ($mb -gt 20) { 'WARN' } else { 'INFO' }
        Write-Host "  $tag $mb MB  $($f.FullName)" -ForegroundColor $col
    }
} else {
    Write-Host "  OK (aucun fichier > 10 MB)" -ForegroundColor Green
}

# -----------------------------------------------------------------------------
# 5. Tailles totales du changeset
# -----------------------------------------------------------------------------
Write-Host "`n=== 5. Taille totale des modifs + nouveaux fichiers ===" -ForegroundColor Cyan
$total = 0
$count = 0
foreach ($line in $status) {
    # Format : "XY <path>"  ou  "XY <old> -> <new>"
    $path = ($line -replace '^...', '').Trim()
    if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
    $path = $path.Trim('"')
    if (Test-Path $path -PathType Leaf -ErrorAction SilentlyContinue) {
        $f = Get-Item $path -ErrorAction SilentlyContinue
        if ($f) { $total += $f.Length; $count += 1 }
    }
}
$kb = [math]::Round($total / 1KB, 1)
Write-Host "  $count fichiers, total : $kb Ko" -ForegroundColor Green

# -----------------------------------------------------------------------------
# 6. Version cohérente dans package.json (root + frontend)
# -----------------------------------------------------------------------------
Write-Host "`n=== 6. Coherence des versions package.json ===" -ForegroundColor Cyan
$vRoot  = (Get-Content package.json -Raw | ConvertFrom-Json).version
$vFront = (Get-Content frontend/package.json -Raw | ConvertFrom-Json).version
Write-Host "  root     : $vRoot"
Write-Host "  frontend : $vFront"
if ($vRoot -eq $vFront) {
    Write-Host "  OK (versions identiques)" -ForegroundColor Green
} else {
    Write-Host "  WARN versions DIFFERENTES" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# 7. CHANGELOG contient la version courante ?
# -----------------------------------------------------------------------------
Write-Host "`n=== 7. CHANGELOG.md contient la version courante ===" -ForegroundColor Cyan
if (Test-Path CHANGELOG.md) {
    $cl = Get-Content CHANGELOG.md -Raw
    if ($cl -match [regex]::Escape("[$vRoot]")) {
        Write-Host "  OK (entree [$vRoot] presente)" -ForegroundColor Green
    } else {
        Write-Host "  KO !! pas d'entree [$vRoot] dans CHANGELOG.md" -ForegroundColor Red
    }
} else {
    Write-Host "  WARN CHANGELOG.md introuvable" -ForegroundColor Yellow
}

# -----------------------------------------------------------------------------
# Recap
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  AUDIT TERMINE -- relis le resultat avant commit" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""
