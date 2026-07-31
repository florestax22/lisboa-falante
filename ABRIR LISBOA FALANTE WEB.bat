@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Lisboa Falante Web 15 Corrigida

echo ============================================================
echo       LISBOA FALANTE - VERSAO WEB 15 CORRIGIDA
echo ============================================================
echo.
echo Esta janela tem de ficar aberta enquanto usas a aplicacao.
echo.

if not exist "segredos\lisboa_falante.env" (
  echo ERRO: falta o ficheiro segredos\lisboa_falante.env
  pause
  exit /b 1
)

set "PYTHON_CMD="
where py >nul 2>nul && set "PYTHON_CMD=py -3"
if not defined PYTHON_CMD (
  where python >nul 2>nul && set "PYTHON_CMD=python"
)
if not defined PYTHON_CMD (
  echo ERRO: Python nao encontrado.
  echo Instala Python 3.8 ou superior e marca Add Python to PATH.
  pause
  exit /b 1
)

%PYTHON_CMD% -c "import flask" >nul 2>nul
if errorlevel 1 (
  echo Flask ainda nao esta instalado. A instalar...
  %PYTHON_CMD% -m pip install -r requirements.txt
  if errorlevel 1 (
    echo.
    echo ERRO: nao foi possivel instalar o Flask.
    echo Confirma a ligacao a Internet e volta a executar este ficheiro.
    pause
    exit /b 1
  )
)

echo A iniciar o servidor...
start "" powershell -NoProfile -WindowStyle Hidden -Command "$u='http://127.0.0.1:5000'; for($i=0;$i -lt 40;$i++){try{Invoke-WebRequest -UseBasicParsing $u -TimeoutSec 1 ^| Out-Null; Start-Process $u; exit}catch{Start-Sleep -Milliseconds 500}}"
%PYTHON_CMD% server.py

echo.
echo O servidor terminou.
pause
endlocal
