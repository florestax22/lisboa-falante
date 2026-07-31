@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Lisboa Falante - Distrito de Lisboa

if not exist "segredos\lisboa_falante.env" (
  echo ERRO: falta o ficheiro segredos\lisboa_falante.env
  echo Copia para essa pasta o ficheiro lisboa_falante.env criado ontem.
  pause
  exit /b 1
)

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m pip install -r requirements.txt --quiet
  start "" http://127.0.0.1:5000
  py -3 server.py
  goto fim
)

where python >nul 2>nul
if %errorlevel%==0 (
  python -m pip install -r requirements.txt --quiet
  start "" http://127.0.0.1:5000
  python server.py
  goto fim
)

echo Python nao encontrado. Instala Python e ativa Add Python to PATH.
start "" https://www.python.org/downloads/windows/
pause

:fim
endlocal
