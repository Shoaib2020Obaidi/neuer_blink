@echo off
title Neuer Blick website server
cd /d "%~dp0"
if not exist node_modules (
  echo Installing email support (first start only)...
  call npm install --no-audit --no-fund
)
start "" http://localhost:3000/admin.html
node server.js
pause
