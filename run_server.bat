@echo off
setlocal

@REM Always run from the folder this .bat lives in (double-click, shortcut or another terminal)
cd /d "%~dp0"

@REM Node may already be installed but missing from this window's PATH
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Installing now through winget...
    where winget >nul 2>&1 || goto :no_winget
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    @REM The installer updates PATH for NEW windows only, so add it to this one by hand
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
) else (
    echo Node.js already installed
)

where node >nul 2>&1 || goto :no_node

@REM The project needs Node 22.12 or newer
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if %errorlevel% neq 0 (
    echo Node.js is older than 22.12. Upgrading through winget...
    where winget >nul 2>&1 || goto :no_winget
    winget upgrade OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)
node -v

@REM to run local
@REM npm is a .cmd script: without CALL this file would stop after the first npm command
echo npm install: installs server + client + shared tooling
call npm install || goto :failed

echo npm run dev: server and client together. Open http://localhost:5173 - press Ctrl+C to stop
call npm run dev

@REM to run on separate laptops
@REM  call npm run build
@REM  call npm start

pause
exit /b 0

:no_winget
echo winget is not available. Install Node.js 22.12+ from https://nodejs.org and run this file again.
pause
exit /b 1

:no_node
echo Node.js was installed but can't be found yet. Close this window and run this file again.
pause
exit /b 1

:failed
echo npm install failed - see the messages above.
pause
exit /b 1
