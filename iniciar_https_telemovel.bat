@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Lisboa Falante HTTPS - nao fechar
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar_https_telemovel.ps1"
echo.
echo O programa terminou.
pause
