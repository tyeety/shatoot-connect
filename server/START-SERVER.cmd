@echo off
setlocal
title ShatootConnect Server
"%~dp0node.exe" "%~dp0server\standalone.cjs" "%~dp0server.config.json"
set "SHATOOTCONNECT_EXIT=%ERRORLEVEL%"
if not "%SHATOOTCONNECT_EXIT%"=="0" (
  echo.
  echo Check server.config.json and make sure the configured port is free.
  pause
)
exit /b %SHATOOTCONNECT_EXIT%
