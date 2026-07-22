@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Installation de PrixRadar Maroc

echo.
echo ========================================
echo   Installation de PrixRadar Maroc
echo ========================================
echo.

where node >nul 2>nul
if errorlevel 1 goto install_node

for /f %%V in ('node -p "process.versions.node.split('.')[0]"') do set "NODE_MAJOR=%%V"
if not defined NODE_MAJOR goto install_node
if %NODE_MAJOR% LSS 22 goto install_node
goto install_dependencies

:install_node
echo Node.js 22 ou plus recent est requis.
where winget >nul 2>nul
if errorlevel 1 goto node_manual
echo Installation automatique de Node.js LTS...
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto node_manual
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>nul
if errorlevel 1 goto node_manual
goto install_dependencies

:node_manual
echo.
echo Installation automatique impossible.
echo Installez Node.js LTS depuis https://nodejs.org puis relancez ce fichier.
pause
exit /b 1

:install_dependencies
echo Version de Node.js detectee :
node --version
echo.
echo Installation des dependances du projet...
if exist package-lock.json (
  call npm ci
) else (
  call npm install
)
if errorlevel 1 goto install_error

echo.
echo Installation terminee avec succes.
echo Utilisez ensuite LANCER-PRIXRADAR.bat.
pause
exit /b 0

:install_error
echo.
echo L'installation des dependances a echoue.
pause
exit /b 1
