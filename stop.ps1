# =============================================================================
# stop.ps1 -- Arret propre du LLM Council
# =============================================================================
# Tue les processus Node qui ecoutent sur les ports backend (8001) et
# frontend (5180), peu importe quelle fenetre les a lances.
#
# Lit automatiquement le PORT du backend depuis .env si present.
#
# Usage :
#   .\stop.ps1                            # arrete les deux services
#   .\stop.ps1 -BackendPort 8002          # port backend custom
#   .\stop.ps1 -FrontendPort 5173         # port frontend custom
#   .\stop.ps1 -BackendOnly               # ne touche pas au frontend
#   .\stop.ps1 -FrontendOnly              # ne touche pas au backend
# =============================================================================

param(
    [int]$BackendPort = 8001,
    [int]$FrontendPort = 5180,
    [switch]$BackendOnly,
    [switch]$FrontendOnly
)

$ErrorActionPreference = "Continue"
$ProjectRoot = $PSScriptRoot

function Write-Step { param($m) Write-Host "`n[$((Get-Date).ToString('HH:mm:ss'))] >> $m" -ForegroundColor Cyan }
function Write-Ok   { param($m) Write-Host "   OK  $m"     -ForegroundColor Green }
function Write-Info { param($m) Write-Host "   ... $m"     -ForegroundColor Gray }
function Write-Warn { param($m) Write-Host "   !!  $m"     -ForegroundColor Yellow }

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  LLM Council -- Arret" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan

# Lit le PORT du .env si dispo (override la valeur par defaut)
$envPath = Join-Path $ProjectRoot ".env"
if (Test-Path $envPath) {
    $portMatch = Get-Content $envPath | Where-Object { $_ -match '^\s*PORT\s*=\s*(\d+)' } | Select-Object -First 1
    if ($portMatch -and $portMatch -match '^\s*PORT\s*=\s*(\d+)') {
        $backendFromEnv = [int]$Matches[1]
        if ($PSBoundParameters.Keys -notcontains 'BackendPort') {
            $BackendPort = $backendFromEnv
            Write-Info "Backend port lu depuis .env : $BackendPort"
        }
    }
}

function Stop-OnPort {
    param(
        [int]$Port,
        [string]$Label
    )

    Write-Step "Arret $Label (port $Port)"

    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    } catch {
        $conns = $null
    }

    if (-not $conns) {
        Write-Info "Aucun processus en ecoute sur le port $Port"
        return
    }

    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    $killed = 0

    foreach ($processId in $pids) {
        if (-not $processId -or $processId -eq 0) { continue }
        try {
            $proc = Get-Process -Id $processId -ErrorAction Stop
            Write-Info "Tue $($proc.ProcessName) (PID $processId)"
            Stop-Process -Id $processId -Force -ErrorAction Stop
            $killed++
        } catch {
            Write-Warn "PID $processId : $($_.Exception.Message)"
        }
    }

    if ($killed -gt 0) {
        Write-Ok "$killed processus arrete(s)"
    } else {
        Write-Warn "Aucun processus n'a pu etre arrete"
    }
}

# Execution
if (-not $FrontendOnly) {
    Stop-OnPort -Port $BackendPort -Label "backend"
}
if (-not $BackendOnly) {
    Stop-OnPort -Port $FrontendPort -Label "frontend"
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  Termine" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "Les fenetres PowerShell parentes peuvent rester ouvertes mais"
Write-Host "les services sont stoppes. Ferme-les a la main si tu veux."
Write-Host ""
