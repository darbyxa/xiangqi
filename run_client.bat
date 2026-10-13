@echo off
setlocal

@REM Shares the game running from run_server.bat (dev mode, port 5173) over the internet with ngrok.
@REM Vite forwards /socket.io to the game server, so one tunnel to 5173 is enough.
cd /d "%~dp0"

@REM ngrok may be installed but missing from this window's PATH
if exist "%LOCALAPPDATA%\ngrok\ngrok.exe" set "PATH=%LOCALAPPDATA%\ngrok;%PATH%"
if exist "%LOCALAPPDATA%\Microsoft\WinGet\Links" set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"

where ngrok >nul 2>&1
if %errorlevel% neq 0 (
    echo ngrok not found. Installing now through winget...
    where winget >nul 2>&1 || goto :no_winget
    winget install ngrok.ngrok --accept-source-agreements --accept-package-agreements
    @REM winget links new tools here, but only NEW windows get it on PATH
    set "PATH=%LOCALAPPDATA%\Microsoft\WinGet\Links;%PATH%"
) else (
    echo ngrok already installed
)

where ngrok >nul 2>&1 || goto :no_ngrok

@REM ngrok refuses to start without an account token (one-time setup)
findstr /c:"authtoken" "%LOCALAPPDATA%\ngrok\ngrok.yml" >nul 2>&1 && goto :token_ok
echo.
echo ngrok needs your authtoken once. Copy it from https://dashboard.ngrok.com/get-started/your-authtoken
set /p "NGROK_TOKEN=Paste it here and press Enter: "
if "%NGROK_TOKEN%"=="" goto :no_token
ngrok config add-authtoken %NGROK_TOKEN% || goto :no_token
:token_ok

@REM Start the game in its own window if it isn't running yet
curl -s -o nul http://localhost:5173 && goto :server_up
echo Game is not running - starting run_server.bat in a new window...
start "Xiangqi server" "%~dp0run_server.bat"
set /a tries=0
:wait_server
@REM wait ~2 seconds (ping also works when timeout can't, e.g. redirected input)
ping -n 3 127.0.0.1 >nul
curl -s -o nul http://localhost:5173 && goto :server_up
set /a tries+=1
if %tries% lss 120 goto :wait_server
echo The game didn't start within 4 minutes - check the "Xiangqi server" window for errors.
pause
exit /b 1
:server_up

echo.
echo Share the "Forwarding" https address below with your opponent. Press Ctrl+C to stop the tunnel.
echo (Free ngrok: each browser sees an ngrok notice page once - click "Visit Site".)
echo.
ngrok http 5173

@REM to share a production build instead (npm run build + npm start in run_server.bat)
@REM  ngrok http 3001

pause
exit /b 0

:no_winget
echo winget is not available. Install ngrok from https://ngrok.com/download and run this file again.
pause
exit /b 1

:no_ngrok
echo ngrok was installed but can't be found yet. Close this window and run this file again.
pause
exit /b 1

:no_token
echo No authtoken saved - ngrok can't start without one.
pause
exit /b 1
