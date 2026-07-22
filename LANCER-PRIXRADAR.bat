@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title PrixRadar Maroc - Ne pas fermer cette fenetre
set "PATH=%ProgramFiles%\nodejs;%PATH%"

where node >nul 2>nul
if errorlevel 1 goto bootstrap

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto bootstrap
if %NODE_MAJOR% LSS 22 goto bootstrap
goto dependencies

:bootstrap
call "%~dp0INSTALLER.bat"
if errorlevel 1 exit /b 1
set "PATH=%ProgramFiles%\nodejs;%PATH%"

:dependencies

if not exist "%~dp0node_modules\vinext\dist\cli.js" (
  call "%~dp0INSTALLER.bat"
  if errorlevel 1 exit /b 1
)

echo.
echo ========================================
echo   PrixRadar Maroc demarre
echo ========================================
echo Cette fenetre doit rester ouverte.
echo La fermer arretera l'application.
echo Adresse : http://localhost:3220/#classement
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-optional-sources.ps1"
start "" /b powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\open-browser.ps1"

call npm run dev

echo.
echo PrixRadar est arrete.
pause
