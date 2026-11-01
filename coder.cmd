@echo off
rem Coder launcher for Windows (cmd). Usage: coder [command]
setlocal
set "ROOT=%~dp0"
if exist "%ROOT%.coder\bun\bun.exe" (
  "%ROOT%.coder\bun\bun.exe" "%ROOT%src\cli.ts" %*
  exit /b %ERRORLEVEL%
)
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROOT%coder.ps1" %*
exit /b %ERRORLEVEL%
