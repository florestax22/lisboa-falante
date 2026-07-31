@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul
cd /d "%~dp0"
title Lisboa Falante 15.4 - Publicacao HTTPS

set "REPO_NAME=lisboa-falante"
set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
set "GIT=%ProgramFiles%\Git\cmd\git.exe"

cls
echo ============================================================
echo LISBOA FALANTE 15.4 - PUBLICACAO HTTPS AUTOMATICA
echo ============================================================
echo.
echo Este ficheiro cria o repositorio, envia o site e ativa o HTTPS.
echo Nao feche esta janela enquanto o processo estiver a decorrer.
echo.

rem --- Localizar ou instalar Git ---
where git >nul 2>nul
if not errorlevel 1 set "GIT=git"
if not exist "%GIT%" (
    echo O Git nao esta instalado. Vou instala-lo agora.
    winget install --id Git.Git -e --accept-source-agreements --accept-package-agreements
    if errorlevel 1 goto ERRO_GIT
    set "GIT=%ProgramFiles%\Git\cmd\git.exe"
)

rem --- Localizar ou instalar GitHub CLI ---
where gh >nul 2>nul
if not errorlevel 1 set "GH=gh"
if not exist "%GH%" (
    echo O GitHub CLI nao esta instalado. Vou instala-lo agora.
    winget install --id GitHub.cli -e --accept-source-agreements --accept-package-agreements
    if errorlevel 1 goto ERRO_GH
    set "GH=%ProgramFiles%\GitHub CLI\gh.exe"
)

:AUTENTICAR
cls
echo ============================================================
echo AUTORIZACAO DA CONTA GITHUB
echo ============================================================
echo.
"%GH%" auth status --hostname github.com >nul 2>nul
if not errorlevel 1 goto AUTENTICADO

echo Vai aparecer um codigo temporario e depois abrir o navegador.
echo No navegador, introduza o codigo e escolha Authorize GitHub.
echo Esta janela so continua quando o login ficar confirmado.
echo.
"%GH%" auth login --hostname github.com --git-protocol https --web

echo.
echo A confirmar o login...
"%GH%" auth status --hostname github.com >nul 2>nul
if errorlevel 1 (
    echo.
    echo O login ainda nao ficou concluido.
    echo Prima ENTER para tentar novamente. Nao precisa fechar o ficheiro.
    pause >nul
    goto AUTENTICAR
)

:AUTENTICADO
"%GH%" auth setup-git >nul 2>nul
for /f "usebackq delims=" %%U in (`"%GH%" api user --jq .login`) do set "GH_USER=%%U"
for /f "usebackq delims=" %%I in (`"%GH%" api user --jq .id`) do set "GH_ID=%%I"
if not defined GH_USER goto ERRO_CONTA

echo.
echo Conta confirmada: %GH_USER%
echo.

rem --- Preparar Git local ---
if not exist ".git" (
    "%GIT%" init -b main
    if errorlevel 1 goto ERRO_REPO
)
"%GIT%" config user.name "%GH_USER%"
"%GIT%" config user.email "%GH_ID%+%GH_USER%@users.noreply.github.com"
"%GIT%" add .
"%GIT%" diff --cached --quiet
if errorlevel 1 "%GIT%" commit -m "Publicar Lisboa Falante 15.4"

set "REPO=%GH_USER%/%REPO_NAME%"
"%GH%" repo view "%REPO%" >nul 2>nul
if errorlevel 1 goto CRIAR_REPO

echo O repositorio %REPO% ja existe.
echo Esta versao sera enviada para esse repositorio.
"%GIT%" remote get-url origin >nul 2>nul
if errorlevel 1 (
    "%GIT%" remote add origin "https://github.com/%REPO%.git"
) else (
    "%GIT%" remote set-url origin "https://github.com/%REPO%.git"
)
"%GIT%" branch -M main
"%GIT%" push -u origin main
if errorlevel 1 goto ERRO_ENVIO
goto CHAVE

:CRIAR_REPO
echo A criar o repositorio publico %REPO%...
"%GH%" repo create "%REPO%" --public --source . --remote origin --push --description "Lisboa Falante - orientacao e deslocacoes acessiveis"
if errorlevel 1 goto ERRO_REPO

:CHAVE
echo.
echo ============================================================
echo CHAVE GOOGLE MAPS
echo ============================================================
echo.
echo Cole a chave Google Maps. Ela nao aparece no ecra.
for /f "usebackq delims=" %%K in (`powershell.exe -NoProfile -Command "$s=Read-Host 'Chave GOOGLE_MAPS_API_KEY' -AsSecureString; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try {[Runtime.InteropServices.Marshal]::PtrToStringBSTR($p)} finally {[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p)}"`) do set "MAPS_KEY=%%K"
if not defined MAPS_KEY (
    echo A chave ficou vazia. Prima ENTER para tentar novamente.
    pause >nul
    goto CHAVE
)

(echo !MAPS_KEY!) | "%GH%" secret set GOOGLE_MAPS_API_KEY --repo "%REPO%"
if errorlevel 1 goto ERRO_CHAVE
set "MAPS_KEY="

rem --- Ativar Pages por Actions ---
echo.
echo A ativar o GitHub Pages e o HTTPS...
"%GH%" api --method POST "repos/%REPO%/pages" -f build_type=workflow >nul 2>nul
if errorlevel 1 "%GH%" api --method PUT "repos/%REPO%/pages" -f build_type=workflow >nul 2>nul

rem Disparar workflow pelo nome do ficheiro, mais fiavel que o nome visivel
"%GH%" workflow run "publicar-pages.yml" --repo "%REPO%" >nul 2>nul
if errorlevel 1 (
    echo O primeiro envio ja iniciou a publicacao automaticamente.
)

echo.
echo ============================================================
echo PUBLICACAO INICIADA COM SUCESSO
echo ============================================================
echo.
echo Repositorio:
echo https://github.com/%REPO%
echo.
echo Endereco HTTPS do Lisboa Falante:
echo https://%GH_USER%.github.io/%REPO_NAME%/
echo.
echo A primeira publicacao pode demorar alguns minutos.
echo Restrinja depois a chave Google Maps a:
echo https://%GH_USER%.github.io/%REPO_NAME%/*
echo.
echo Prima ENTER para abrir o endereco do site.
pause >nul
start "" "https://%GH_USER%.github.io/%REPO_NAME%/"
exit /b 0

:ERRO_GIT
echo.
echo ERRO: nao foi possivel instalar o Git.
goto FIM_ERRO
:ERRO_GH
echo.
echo ERRO: nao foi possivel instalar o GitHub CLI.
goto FIM_ERRO
:ERRO_CONTA
echo.
echo ERRO: nao consegui identificar a conta GitHub.
goto FIM_ERRO
:ERRO_REPO
echo.
echo ERRO: nao foi possivel criar ou preparar o repositorio.
goto FIM_ERRO
:ERRO_ENVIO
echo.
echo ERRO: nao foi possivel enviar os ficheiros para o GitHub.
goto FIM_ERRO
:ERRO_CHAVE
echo.
echo ERRO: nao foi possivel guardar a chave Google Maps.
goto FIM_ERRO
:FIM_ERRO
echo.
echo Nada foi apagado do computador.
echo Prima ENTER para fechar.
pause >nul
exit /b 1
