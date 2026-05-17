@echo off
REM ============================================================================
REM stop.bat -- Wrapper pour stop.ps1
REM Double-clic pour arreter le LLM Council (backend + frontend)
REM ============================================================================
setlocal

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%stop.ps1"

if not exist "%PS_SCRIPT%" (
    echo.
    echo ERREUR : stop.ps1 introuvable dans :
    echo   %SCRIPT_DIR%
    echo.
    pause
    exit /b 1
)

echo.
echo ============================================
echo   Arret LLM Council
echo ============================================
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Unblock-File -Path '%PS_SCRIPT%' -ErrorAction SilentlyContinue; & '%PS_SCRIPT%'"

set "RC=%ERRORLEVEL%"
echo.
if "%RC%"=="0" (
    echo ============================================
    echo Services arretes.
    echo ============================================
) else (
    echo ============================================
    echo Arret termine avec code : %RC%
    echo ============================================
)
echo.
pause
endlocal
exit /b 0
