@echo off
setlocal
cd /d "%~dp0"

set "NODE_DIR=%~dp0node-v24.12.0-win-x64"
if exist "%NODE_DIR%\node.exe" (
  echo Using bundled Node from "%NODE_DIR%" ...
  set "PATH=%NODE_DIR%;%NODE_DIR%\node_modules\npm\bin;%PATH%"
)

if not exist node_modules (
  echo Installing dependencies...
  npm install
  if errorlevel 1 (
    echo npm install failed. Press any key to exit.
    pause >nul
    exit /b 1
  )
)

rem 未安装 Node.js 时给出友好提示（仓库不含内置运行时，需自行安装 Node.js 18+）
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo [ERROR] Node.js is not installed or not in PATH.
  echo         Please install Node.js 18 or newer from https://nodejs.org/
  echo.
  pause >nul
  exit /b 1
)

echo Starting FIT web tool ... browser will open automatically when ready.
node server.js
if errorlevel 1 (
  echo.
  echo Server terminated unexpectedly. Press any key to exit.
  pause >nul
)

endlocal
