@echo off
setlocal
title Xiangqi

@REM ==========================================================================
@REM  Double-click to host a Xiangqi game that phones and laptops anywhere can join.
@REM  Installs what's missing (Node.js, ngrok), builds the game, starts the server and
@REM  the ngrok tunnel, then prints the link to share and opens it in your browser.
@REM
@REM    play_windows.bat        host over the internet (ngrok)
@REM    play_windows.bat lan    same Wi-Fi only, no ngrok needed
@REM
@REM  Games are saved: close this window any time and run it again to carry on.
@REM ==========================================================================

@REM Always run from the folder this .bat lives in (double-click, shortcut or another terminal)
cd /d "%~dp0"

echo.
echo [1/4] Node.js
@REM Node may already be installed but missing from this window's PATH
if exist "%ProgramFiles%\nodejs\node.exe" set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Node.js not found. Installing it through winget...
    where winget >nul 2>&1 || goto :no_winget_node
    winget install OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    @REM The installer updates PATH for NEW windows only, so add it to this one by hand
    set "PATH=%ProgramFiles%\nodejs;%PATH%"
)
where node >nul 2>&1 || goto :no_node
@REM The project needs Node 22.12 or newer
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>22||(a===22&&b>=12)?0:1)"
if %errorlevel% neq 0 (
    echo Node.js is older than 22.12. Upgrading through winget...
    where winget >nul 2>&1 || goto :no_winget_node
    winget upgrade OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
)
node -v

echo.
echo [2/4] ngrok
if /i "%~1"=="lan" (
    echo Skipped - same Wi-Fi mode.
    set "TUNNEL=none"
    goto :ngrok_done
)
@REM ngrok may be installed but missing from this window's PATH
if exist "%LOCALAPPDATA%\ngrok\ngrok.exe" set "PATH=%LOCALAPPDATA%\ngrok;%PATH%"
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links" set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
where ngrok >nul 2>&1
if %errorlevel% neq 0 (
    echo ngrok not found. Installing it through winget...
    where winget >nul 2>&1 || goto :no_winget_ngrok
    winget install ngrok.ngrok --accept-source-agreements --accept-package-agreements
    @REM winget links new tools here, but only NEW windows get it on PATH
    set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
)
where ngrok >nul 2>&1 || goto :no_ngrok
@REM ngrok refuses to start without an account token (one-time setup)
findstr /c:"authtoken" "%LOCALAPPDATA%\ngrok\ngrok.yml" >nul 2>&1 && goto :token_ok
echo.
echo ngrok needs your free account's authtoken once.
echo Sign up / log in, then copy it from https://dashboard.ngrok.com/get-started/your-authtoken
set /p "NGROK_TOKEN=Paste it here and press Enter: "
if "%NGROK_TOKEN%"=="" goto :no_token
ngrok config add-authtoken %NGROK_TOKEN% || goto :no_token
:token_ok
echo ngrok is ready
:ngrok_done

echo.
echo [3/4] Installing and building the game (the first run takes a few minutes)
@REM npm is a .cmd script: without CALL this file would stop after the first npm command
call npm install --no-audit --no-fund || goto :failed
call npm run build || goto :failed

echo.
echo [4/4] Starting
node scripts\host.mjs
echo.
pause
exit /b 0

:no_winget_node
echo winget is not available. Install Node.js 22.12+ from https://nodejs.org and run this file again.
pause
exit /b 1

:no_node
echo Node.js was installed but can't be found yet. Close this window and run this file again.
pause
exit /b 1

:no_winget_ngrok
echo winget is not available. Install ngrok from https://ngrok.com/download and run this file again.
echo (Or run "play_windows.bat lan" to play on the same Wi-Fi without ngrok.)
pause
exit /b 1

:no_ngrok
echo ngrok was installed but can't be found yet. Close this window and run this file again.
pause
exit /b 1

:no_token
echo No authtoken saved - ngrok can't start without one. Run this file again when you have it.
pause
exit /b 1

:failed
echo Installing or building failed - see the messages above.
pause
exit /b 1
