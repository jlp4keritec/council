# ssh-check-export.ps1
# Diagnostic complet de la feature export sur council.mesoutilsagile.com
# Verifie : fichiers backend, deps npm, endpoint server.js, bundle frontend,
#          PM2, test live de /export, vhost Nginx
# Usage : .\ssh-check-export.ps1

$ErrorActionPreference = "Stop"

# =====================================================================
# 1. Resolution deploy-config.json
# =====================================================================
$configPaths = @(
    "$PSScriptRoot\deploy-config.json",
    "$(Get-Location)\deploy-config.json",
    "C:\Agile\deploy-config.json"
)
$configFile = $null
foreach ($p in $configPaths) {
    if ($p -and (Test-Path $p)) { $configFile = $p; break }
}
if (-not $configFile) {
    Write-Host "[KO] deploy-config.json introuvable. Cherche dans :" -ForegroundColor Red
    $configPaths | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    exit 1
}
Write-Host "[OK] deploy-config.json : $configFile" -ForegroundColor Green
$cfg = Get-Content $configFile -Raw | ConvertFrom-Json

# =====================================================================
# 2. Blob bash (heredoc single-quote -> zero interpolation PowerShell)
# =====================================================================
$bash = @'
set -u
PROJ=/home/ubuntu/llm-council

echo ""
echo "============================================================"
echo " 1. Backend - module exporters/"
echo "============================================================"
if [ -d "$PROJ/backend/exporters" ]; then
  echo "[OK] Dossier exporters/ present"
  ls -la "$PROJ/backend/exporters/" 2>/dev/null | grep -E "\.js$" | awk '{print "  - " $NF " (" $5 " bytes)"}'
  for f in json.js markdown.js docx.js pptx.js; do
    if [ -f "$PROJ/backend/exporters/$f" ]; then
      echo "  [OK] $f"
    else
      echo "  [KO] $f MANQUANT"
    fi
  done
else
  echo "[KO] Dossier $PROJ/backend/exporters/ INEXISTANT"
fi

echo ""
echo "============================================================"
echo " 2. Backend - deps npm (docx + pptxgenjs)"
echo "============================================================"
cd "$PROJ" 2>/dev/null || { echo "[KO] cd $PROJ impossible"; exit 1; }
if [ -f package.json ]; then
  echo "-- package.json racine --"
  grep -E "\"(docx|pptxgenjs)\"" package.json | sed "s/^/  /" || echo "  [KO] aucune declaree"
fi
if [ -f backend/package.json ]; then
  echo "-- backend/package.json --"
  grep -E "\"(docx|pptxgenjs)\"" backend/package.json | sed "s/^/  /" || echo "  [INFO] aucune au niveau backend"
fi
echo "-- node_modules installes --"
for dep in docx pptxgenjs; do
  FOUND=0
  for nm in "$PROJ/node_modules/$dep" "$PROJ/backend/node_modules/$dep"; do
    if [ -d "$nm" ]; then
      V=$(node -p "require('$nm/package.json').version" 2>/dev/null || echo "?")
      LOC=$(echo "$nm" | sed "s|$PROJ/||")
      echo "  [OK] $dep@$V ($LOC)"
      FOUND=1
      break
    fi
  done
  [ $FOUND -eq 0 ] && echo "  [KO] $dep NON INSTALLE"
done

echo ""
echo "============================================================"
echo " 3. Backend - endpoint /export dans server.js"
echo "============================================================"
if [ -f "$PROJ/backend/server.js" ]; then
  HITS=$(grep -nE "/export|exportJson|exportMd|exportDocx|exportPptx|exporters" "$PROJ/backend/server.js" 2>/dev/null | head -10)
  if [ -n "$HITS" ]; then
    echo "[OK] References dans server.js :"
    echo "$HITS" | sed "s/^/  /"
  else
    echo "[KO] Aucune reference 'export' dans backend/server.js"
  fi
else
  echo "[KO] backend/server.js introuvable"
fi

echo ""
echo "============================================================"
echo " 4. Frontend - bundle dist/"
echo "============================================================"
DIST=""
for d in "$PROJ/frontend/dist" "$PROJ/dist" "$PROJ/public"; do
  if [ -d "$d" ]; then DIST="$d"; break; fi
done
if [ -n "$DIST" ]; then
  echo "Bundle : $DIST"
  if [ -f "$DIST/index.html" ]; then
    BUILD_DATE=$(stat -c "%y" "$DIST/index.html" 2>/dev/null | cut -d. -f1)
    echo "  Build date : $BUILD_DATE"
    grep -oE "assets/[a-zA-Z0-9_.-]+\.(js|css)" "$DIST/index.html" 2>/dev/null | head -4 | sed "s/^/  /"
  fi
  echo "-- Recherche chaines export dans le JS minifie --"
  HITS=$(grep -roE "(exportMd|exportJson|exportDocx|exportPptx|Markdown|PowerPoint|\.docx|\.pptx|format=md|format=json|format=docx|format=pptx)" "$DIST" --include="*.js" 2>/dev/null | sed "s|$DIST/||" | sort -u | head -20)
  if [ -n "$HITS" ]; then
    echo "$HITS" | sed "s/^/  /"
  else
    echo "  [KO] Aucune chaine 'export' dans le bundle JS"
  fi
else
  echo "[KO] Aucun dossier dist/ ou public/ trouve"
fi

echo ""
echo "============================================================"
echo " 5. PM2 - statut llm-council"
echo "============================================================"
pm2 jlist 2>/dev/null > /tmp/pm2.json
if [ -s /tmp/pm2.json ]; then
  node -e "
    const procs = JSON.parse(require('fs').readFileSync('/tmp/pm2.json','utf8'));
    const p = procs.find(x => x.name === 'llm-council');
    if (!p) { console.log('  [KO] Process llm-council absent de pm2'); process.exit(0); }
    console.log('  Status     :', p.pm2_env.status);
    console.log('  Uptime     :', new Date(p.pm2_env.pm_uptime).toISOString());
    console.log('  Restarts   :', p.pm2_env.restart_time);
    console.log('  Port (env) :', p.pm2_env.env.PORT || '(non defini)');
    console.log('  Script     :', p.pm2_env.pm_exec_path);
  " 2>/dev/null || echo "  [KO] node parse KO"
else
  echo "[KO] pm2 jlist vide ou KO"
fi

echo ""
echo "============================================================"
echo " 6. Test live - /api/conversations/.../export"
echo "============================================================"
PORT=$(node -e "
  try {
    const p = JSON.parse(require('fs').readFileSync('/tmp/pm2.json','utf8')).find(x=>x.name==='llm-council');
    console.log(p && p.pm2_env.env.PORT || '8001');
  } catch(e) { console.log('8001'); }
" 2>/dev/null)
echo "Port utilise : $PORT"

# Note : si la route /conversations est protegee par auth (v2.8), curl sans cookie -> 401
# On affiche le code retour pour distinguer 404 (endpoint absent) de 401 (endpoint present mais auth requise)

LIST=$(curl -s -o /tmp/conv.json -w "%{http_code}" "http://localhost:$PORT/api/conversations" 2>/dev/null)
echo "GET /api/conversations -> HTTP $LIST"
if [ "$LIST" = "200" ]; then
  FIRST_ID=$(node -e "
    try {
      const d = JSON.parse(require('fs').readFileSync('/tmp/conv.json','utf8'));
      const arr = Array.isArray(d) ? d : (d.conversations || []);
      console.log(arr[0] ? (arr[0].id || arr[0].conversation_id || '') : '');
    } catch(e) { console.log(''); }
  " 2>/dev/null)
  if [ -n "$FIRST_ID" ]; then
    echo "ID test : $FIRST_ID"
    for fmt in json md docx pptx; do
      OUT="/tmp/exp.$fmt"
      HTTP=$(curl -s -o "$OUT" -w "%{http_code}" "http://localhost:$PORT/api/conversations/$FIRST_ID/export?format=$fmt" 2>/dev/null)
      SZ=$(stat -c %s "$OUT" 2>/dev/null || echo 0)
      echo "  /export?format=$fmt -> HTTP $HTTP ($SZ bytes)"
    done
  else
    echo "[INFO] Pas d'ID extrait, test endpoint impossible"
  fi
elif [ "$LIST" = "401" ] || [ "$LIST" = "403" ]; then
  echo "[INFO] API protegee par auth. Test direct sans cookie pour voir si la route existe :"
  HTTP=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT/api/conversations/test-id-bidon/export?format=md" 2>/dev/null)
  echo "  /export?format=md (sans auth) -> HTTP $HTTP"
  echo "  -> 401/403 = route presente mais auth requise (NORMAL)"
  echo "  -> 404     = route ABSENTE du backend (ANOMALIE)"
fi

echo ""
echo "============================================================"
echo " 7. Nginx - vhost council"
echo "============================================================"
VHOST=$(ls /etc/nginx/sites-enabled/ 2>/dev/null | grep -i council | head -1)
if [ -n "$VHOST" ]; then
  echo "[OK] vhost actif : $VHOST"
  cat "/etc/nginx/sites-enabled/$VHOST" 2>/dev/null | grep -nE "(proxy_pass|server_name|listen|client_max_body_size)" | sed "s/^/  /"
else
  echo "[KO] aucun vhost council dans sites-enabled/"
fi

echo ""
echo "============================================================"
echo " DIAGNOSTIC TERMINE"
echo "============================================================"
'@

# =====================================================================
# 3. Encodage base64 + envoi via SSH
# =====================================================================
$bytes = [Text.Encoding]::UTF8.GetBytes($bash)
$b64 = [Convert]::ToBase64String($bytes)

$sshArgs = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15")
if ($cfg.port) { $sshArgs += "-p", "$($cfg.port)" }
if ($cfg.authMethod -eq "key" -and $cfg.sshKeyPath) { $sshArgs += "-i", $cfg.sshKeyPath }
$sshArgs += "$($cfg.user)@$($cfg.host)"
$sshArgs += "echo $b64 | base64 -d | bash"

Write-Host ""
Write-Host "Lancement du diagnostic sur $($cfg.host)..." -ForegroundColor Cyan
Write-Host "(verifie : backend exporters/, deps npm, route /export, bundle frontend, PM2, live test, Nginx)" -ForegroundColor DarkGray
Write-Host ""

& ssh @sshArgs | Out-Host
$rc = $LASTEXITCODE

Write-Host ""
if ($rc -eq 0) {
    Write-Host "[OK] Diagnostic termine. Colle la sortie ci-dessus dans le chat suivant." -ForegroundColor Green
} else {
    Write-Host "[KO] Diagnostic termine avec code $rc" -ForegroundColor Red
}
exit $rc
