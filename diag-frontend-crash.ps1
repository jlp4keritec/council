# diag-frontend-crash.ps1 -- inspecte le .env distant + le format des conversations
# Encode le bash en base64 (skill powershell-bash-escapes, regle 5)

$bash = @'
echo "=== .env (THEME / GROUNDING) ==="
grep -E "^(THEME_TAGGING|GROUNDING)" /home/ubuntu/llm-council/.env 2>/dev/null || echo "(rien)"
echo ""
echo "=== Nb de conversations dans data/ ==="
ls /home/ubuntu/llm-council/data/conversations/*.json 2>/dev/null | wc -l
echo ""
echo "=== 3 derniers titres bruts (jq) ==="
for f in $(ls -t /home/ubuntu/llm-council/data/conversations/*.json 2>/dev/null | head -3); do
  echo "-- $(basename $f) --"
  node -e "const d=require('$f'); console.log('title:', JSON.stringify(d.title)); console.log('theme:', JSON.stringify(d.theme)); console.log('owner:', d.owner||'(legacy)');"
  echo ""
done
echo "=== users.json : premiere ligne ==="
head -c 400 /home/ubuntu/llm-council/data/users.json 2>/dev/null
echo ""
'@

$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($bash))

# Charger la config SSH (priorite C:\Agile\deploy-config.json)
$cfgPath = if (Test-Path "deploy-config.json") { "deploy-config.json" }
           elseif (Test-Path "C:\Agile\deploy-config.json") { "C:\Agile\deploy-config.json" }
           else { throw "deploy-config.json introuvable" }

$cfg = Get-Content $cfgPath -Raw | ConvertFrom-Json
$sshArgs = @("-o","StrictHostKeyChecking=no","-p",$cfg.port)
if ($cfg.authMethod -eq "key" -and $cfg.sshKeyPath) { $sshArgs += "-i", $cfg.sshKeyPath }

& ssh @sshArgs "$($cfg.user)@$($cfg.host)" "echo $b64 | base64 -d | bash"
