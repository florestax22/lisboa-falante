@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Publicar Lisboa Falante em HTTPS
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0publicar_https.ps1"
echo.
echo Prima uma tecla para fechar.
pause >nul
