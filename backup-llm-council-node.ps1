# ============================================================================
# backup-llm-council-node.ps1 — Backup ZIP du repo llm-council-node sans node_modules
# Sortie : C:\Agile\llm-council-node_YYYYMMDD-HHmmss.zip
#
# Usage :
#   .\backup-llm-council-node.ps1                                       # backup complet
#   .\backup-llm-council-node.ps1 -ExcludeGit                           # sans .git
#   .\backup-llm-council-node.ps1 -ExcludeDb                            # sans data\*.db
#   .\backup-llm-council-node.ps1 -ExcludeBak                           # sans .bak / copies
#   .\backup-llm-council-node.ps1 -ExcludeGit -ExcludeDb -ExcludeBak    # minimal
#
# Exclusions par defaut (toujours) : node_modules, .cache, logs, dist, build, .vite
#
# Si bloque par MOTW (transfere via ZIP/email) :
#   Unblock-File .\backup-llm-council-node.ps1
# ============================================================================

[CmdletBinding()]
param(
    [string]$Source  = "C:\Agile\llm-council-node",
    [string]$DestDir = "C:\Agile",
    [string[]]$Exclude = @(
        '\\node_modules\\',
        '\\\.cache\\',
        '\\logs\\',
        '\\dist\\',
        '\\build\\',
        '\\\.vite\\'
    ),
    [switch]$ExcludeGit,
    [switch]$ExcludeDb,
    [switch]$ExcludeBak
)

$ErrorActionPreference = 'Stop'
Add-Type -Assembly System.IO.Compression
Add-Type -Assembly System.IO.Compression.FileSystem

# Normalisation
$src = (Resolve-Path $Source).Path.TrimEnd('\')
if (-not (Test-Path $src -PathType Container)) { throw "Source introuvable : $src" }
if (-not (Test-Path $DestDir -PathType Container)) {
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
}

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$leaf = Split-Path $src -Leaf
$zip  = Join-Path $DestDir "${leaf}_${timestamp}.zip"

# Patterns a exclure (regex sur le path complet)
$patterns = [System.Collections.Generic.List[string]]::new()
$patterns.AddRange([string[]]$Exclude)
if ($ExcludeGit) {
    $patterns.Add('\\\.git\\')
}
if ($ExcludeDb) {
    $patterns.Add('\\data\\.*\.db(-wal|-shm)?$')
    $patterns.Add('\\data\\.*\.db\.bak')
}
if ($ExcludeBak) {
    $patterns.Add('\.bak$')
    $patterns.Add('\.db\.bak-')
    $patterns.Add(' - Copie\.')
}

Write-Host "Source : $src"
Write-Host "Cible  : $zip"
Write-Host "Exclus : $($patterns -join '  ;  ')"
Write-Host ""

$sw = [Diagnostics.Stopwatch]::StartNew()

# Selection des fichiers
$files = Get-ChildItem -LiteralPath $src -Recurse -File -Force | Where-Object {
    $p = $_.FullName
    $skip = $false
    foreach ($pat in $patterns) {
        if ($p -match $pat) { $skip = $true; break }
    }
    -not $skip
}

$total = ($files | Measure-Object).Count
if ($total -eq 0) { throw "Aucun fichier a zipper apres filtrage." }
Write-Host "$total fichier(s) a archiver."

# Creation du ZIP
if (Test-Path $zip) { Remove-Item $zip -Force }
$archive = [System.IO.Compression.ZipFile]::Open($zip, [System.IO.Compression.ZipArchiveMode]::Create)

$i = 0
$bytesTotal = 0L
try {
    foreach ($f in $files) {
        $i++
        $rel = $f.FullName.Substring($src.Length + 1).Replace('\','/')
        try {
            [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
                $archive, $f.FullName, $rel,
                [System.IO.Compression.CompressionLevel]::Optimal
            )
            $bytesTotal += $f.Length
        } catch {
            Write-Warning "Skip : $rel  ($($_.Exception.Message))"
        }
        if ($i % 50 -eq 0 -or $i -eq $total) {
            Write-Progress -Activity "Zipping" -Status "$i / $total" -PercentComplete ([int](($i / $total) * 100))
        }
    }
} finally {
    $archive.Dispose()
    Write-Progress -Activity "Zipping" -Completed
}

$sw.Stop()
$zipSize = (Get-Item $zip).Length
$ratio = if ($bytesTotal -gt 0) { [math]::Round((1 - $zipSize / $bytesTotal) * 100, 1) } else { 0 }

Write-Host ""
Write-Host "[OK] Termine en $([math]::Round($sw.Elapsed.TotalSeconds, 1)) s"
Write-Host "     Fichiers : $i"
Write-Host "     Source   : $([math]::Round($bytesTotal / 1MB, 1)) Mo"
Write-Host "     ZIP      : $([math]::Round($zipSize / 1MB, 1)) Mo (compression $ratio %)"
Write-Host "     Sortie   : $zip"
