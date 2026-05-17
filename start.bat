@echo off
REM ============================================================================
REM start.bat -- Wrapper pour start.ps1
REM Double-clic pour demarrer le LLM Council (backend + frontend)
REM ============================================================================
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%start.ps1"

if not exist "%PS_SCRIPT%" (
    echo.
    echo ERREUR : start.ps1 introuvable dans :
    echo   %SCRIPT_DIR%
    echo.
    pause
    exit /b 1
)

:menu
cls
echo.
echo ============================================
echo   Demarrage LLM Council
echo ============================================
echo.
echo   1. Demarrage standard   ^(verifie / installe les deps si besoin^)
echo   2. Demarrage rapide     ^(saute la verif npm, si deps deja installees^)
echo   0. Quitter
echo.
set "CHOICE="
set /p "CHOICE=Votre choix [0-2] : "

if "%CHOICE%"=="1" set "FLAGS=" & goto run
if "%CHOICE%"=="2" set "FLAGS=-SkipInstall" & goto run
if "%CHOICE%"=="0" goto end

echo.
echo Choix invalide.
timeout /t 2 /nobreak >nul
goto menu

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
    echo Backend et frontend sont en cours de demarrage
    echo dans 2 fenetres PowerShell separees.
    echo.
    echo Frontend : http://localhost:5180
    echo Backend  : http://localhost:8001
    echo.
    echo Tu peux fermer cette fenetre.
    echo Pour arreter les services : double-clic sur stop.bat
    echo ============================================
) else (
    echo ============================================
    echo Demarrage termine avec code : %RC%
    echo ============================================
)
echo.
pause

:end
endlocal
exit /b 0
