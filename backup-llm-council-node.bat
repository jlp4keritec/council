@echo off
REM ============================================================================
REM backup-llm-council-node.bat - Wrapper pour backup-llm-council-node.ps1
REM Doit etre place dans le meme dossier que le .ps1
REM
REM - Auto-Unblock-File du .ps1 (contourne le blocage MOTW)
REM - Bypass d'execution policy pour la session uniquement
REM - Menu interactif des modes de backup courants
REM ============================================================================
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%backup-llm-council-node.ps1"

if not exist "%PS_SCRIPT%" (
    echo.
    echo ERREUR : backup-llm-council-node.ps1 introuvable dans :
    echo   %SCRIPT_DIR%
    echo.
    echo Place ce .bat dans le meme dossier que le .ps1 et relance.
    echo.
    pause
    exit /b 1
)

:menu
cls
echo.
echo ============================================
echo   Backup llm-council-node
echo ============================================
echo.
echo   Cible : C:\Agile\llm-council-node_YYYYMMDD-HHmmss.zip
echo.
echo   1. Complet                    (avec .git + .db + .bak - le plus lourd)
echo   2. Sans DB                    (garde .git, exclut data\*.db)             ^<-- recommande avant deploiement
echo   3. Sans DB ni .git            (rapide)
echo   4. Minimal                    (sans .git, sans .db, sans .bak)
echo   5. Personnalise               (saisie des flags)
echo   0. Quitter
echo.
set "CHOICE="
set /p "CHOICE=Votre choix [0-5] : "

if "%CHOICE%"=="1" set "FLAGS=" & goto run
if "%CHOICE%"=="2" set "FLAGS=-ExcludeDb" & goto run
if "%CHOICE%"=="3" set "FLAGS=-ExcludeDb -ExcludeGit" & goto run
if "%CHOICE%"=="4" set "FLAGS=-ExcludeDb -ExcludeGit -ExcludeBak" & goto run
if "%CHOICE%"=="5" goto custom
if "%CHOICE%"=="0" goto end

echo.
echo Choix invalide.
timeout /t 2 /nobreak >nul
goto menu

:custom
echo.
echo Flags disponibles : -ExcludeGit  -ExcludeDb  -ExcludeBak
echo Exemple : -ExcludeDb -ExcludeBak
echo (laisser vide pour backup complet)
echo.
set "FLAGS="
set /p "FLAGS=Flags : "
goto run

:run
echo.
echo ============================================
echo Lancement avec : %FLAGS%
echo ============================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%PS_SCRIPT%' -ErrorAction SilentlyContinue; & '%PS_SCRIPT%' %FLAGS%"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
    echo ============================================
    echo Backup termine avec succes.
    echo ============================================
) else (
    echo ============================================
    echo Backup termine avec code de sortie : %RC%
    echo ============================================
)
echo.
pause
goto end

:end
endlocal
exit /b 0
