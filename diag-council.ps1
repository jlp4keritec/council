# =============================================================================
# diag-council.ps1 -- Diagnostic du LLM Council en production
# =============================================================================
# Lit deploy-config.json et lance plusieurs commandes SSH pour diagnostiquer
# l'etat du service llm-council sur le VPS.
#
# Usage :
#   .\diag-council.ps1            # diag complet
#   .\diag-council.ps1 -Quick     # juste pm2 list + health
#   .\diag-council.ps1 -Logs 100  # plus de lignes de logs PM2 (defaut 50)
# =============================================================================

param(
    [switch]$Quick,
    [int]$Logs = 50
)

$ErrorActionPreference = "Continue"

# -----------------------------------------------------------------------------
# Lecture du deploy-config.json (memes emplacements que deploy-council.ps1)
# -----------------------------------------------------------------------------
$searchPaths = @(
    (Join-Path $PSScriptRoot "deploy-config.json"),
    (Join-Path (Get-Location) "deploy-config.json"),
    "C:\Agile\deploy-config.json",
    "C:\vpn\wg-vpn-deploy\deploy-config.json"
)

$cfgPath = $null
foreach ($p in $searchPaths) {
    if (Test-Path $p) { $cfgPath = $p; break }
}

if (-not $cfgPath) {
    Write-Host "ERREUR : deploy-config.json introuvable. Chemins testes :" -ForegroundColor Red
    $searchPaths | ForEach-Object { Write-Host "  $_" }
    exit 1
}

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$key = $cfg.sshKeyPath
$target = "$($cfg.user)@$($cfg.host)"
$PM2_NAME = "llm-council"
$APP_PORT = 5706

# Helper SSH
function Run-Ssh {
    param([string]$Title, [string]$Cmd)
    Write-Host ""
    Write-Host "=== $Title ===" -ForegroundColor Cyan
    & ssh -i $key -o StrictHostKeyChecking=no $target $Cmd | Out-Host
}

# -----------------------------------------------------------------------------
# Banner
# -----------------------------------------------------------------------------
Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  Diagnostic LLM Council ($target)" -ForegroundColor Cyan
Write-Host "  Config : $cfgPath" -ForegroundColor Gray
Write-Host "==================================================" -ForegroundColor Cyan

# -----------------------------------------------------------------------------
# Diags
# -----------------------------------------------------------------------------
Run-Ssh "1. PM2 list (statut du service)" "pm2 list"

Run-Ssh "2. Health check local (port $APP_PORT)" "curl -s -i http://localhost:$APP_PORT/health | head -20"

if (-not $Quick) {
    Run-Ssh "3. PM2 logs llm-council (derniers $Logs lignes)" "pm2 logs $PM2_NAME --lines $Logs --nostream"

    Run-Ssh "4. Nginx error.log (general)" "sudo tail -30 /var/log/nginx/error.log"

    Run-Ssh "5. Nginx access.log council (10 derniers hits)" "sudo tail -10 /var/log/nginx/access.log 2>/dev/null | grep -i council || echo 'aucun hit recent council'"

    Run-Ssh "6. Verif que frontend/dist/ existe et est lisible par Nginx" "ls -la /home/ubuntu/llm-council/frontend/dist/ 2>&1 | head -10 && echo '---' && sudo -u www-data cat /home/ubuntu/llm-council/frontend/dist/index.html 2>&1 | head -3"

    Run-Ssh "7. Permissions de /home/ubuntu (chmod important pour Nginx)" "ls -ld /home/ubuntu /home/ubuntu/llm-council /home/ubuntu/llm-council/frontend /home/ubuntu/llm-council/frontend/dist"

    Run-Ssh "8. .env present + bon port" "ls -la /home/ubuntu/llm-council/.env && grep -E '^(PORT|HOST)' /home/ubuntu/llm-council/.env"
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Diagnostic termine" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
