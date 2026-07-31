$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot

function Pausa-Final {
    Write-Host ""
    Read-Host "Prima ENTER para fechar"
}

try {
    Write-Host "LISBOA FALANTE 15.4 - PUBLICACAO HTTPS" -ForegroundColor Cyan
    Write-Host "Este assistente cria o repositorio lisboa-falante e publica-o no GitHub Pages." 
    Write-Host ""

    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        Write-Host "FALTA O GIT." -ForegroundColor Yellow
        Write-Host "Instale-o com este comando no PowerShell:" 
        Write-Host "winget install --id Git.Git -e" -ForegroundColor White
        Pausa-Final
        exit 1
    }

    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        Write-Host "FALTA O GITHUB CLI." -ForegroundColor Yellow
        Write-Host "Instale-o com este comando no PowerShell:" 
        Write-Host "winget install --id GitHub.cli -e" -ForegroundColor White
        Pausa-Final
        exit 1
    }

    Write-Host "A verificar a entrada na conta GitHub..."
    gh auth status 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Vai abrir o processo oficial de entrada no GitHub." -ForegroundColor Yellow
        gh auth login --web --git-protocol https
        if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel iniciar sessao no GitHub." }
    }

    gh auth setup-git | Out-Null

    $userJson = gh api user | ConvertFrom-Json
    $login = $userJson.login
    $userId = $userJson.id
    if (-not $login) { throw "Nao foi possivel obter o nome da conta GitHub." }

    Write-Host "Conta detetada: $login"

    if (-not (Test-Path '.git')) {
        git init -b main | Out-Null
    }

    git config user.name $login
    git config user.email "$userId+$login@users.noreply.github.com"

    git add .
    $changes = git status --porcelain
    if ($changes) {
        git commit -m "Publicar Lisboa Falante 15.4" | Out-Null
    }

    $repo = "$login/lisboa-falante"
    gh repo view $repo 1>$null 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "O repositorio $repo ja existe." -ForegroundColor Yellow
        $resposta = Read-Host "Escreva SIM para enviar esta versao para esse repositorio; outra resposta cancela"
        if ($resposta -ne 'SIM') { throw "Operacao cancelada para evitar substituir um repositorio existente." }

        $origin = git remote get-url origin 2>$null
        if ($LASTEXITCODE -ne 0) {
            git remote add origin "https://github.com/$repo.git"
        } elseif ($origin -ne "https://github.com/$repo.git") {
            git remote set-url origin "https://github.com/$repo.git"
        }
        git push -u origin main
    } else {
        Write-Host "A criar o repositorio publico $repo..."
        gh repo create $repo --public --source . --remote origin --push --description "Lisboa Falante - orientacao e deslocacoes acessiveis no distrito de Lisboa"
        if ($LASTEXITCODE -ne 0) { throw "Falhou a criacao ou o envio do repositorio." }
    }

    Write-Host ""
    Write-Host "Agora cole a chave Google Maps. O texto nao aparecera no ecra." -ForegroundColor Yellow
    $segura = Read-Host "Chave GOOGLE_MAPS_API_KEY" -AsSecureString
    $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try {
        $chave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
    } finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }
    if ([string]::IsNullOrWhiteSpace($chave)) { throw "A chave ficou vazia." }

    $chave | gh secret set GOOGLE_MAPS_API_KEY --repo $repo
    if ($LASTEXITCODE -ne 0) { throw "Nao foi possivel guardar a chave como secret." }
    Remove-Variable chave -ErrorAction SilentlyContinue

    Write-Host "A ativar o GitHub Pages com publicacao por Actions..."
    gh api --method POST "repos/$repo/pages" -f build_type=workflow 1>$null 2>$null
    if ($LASTEXITCODE -ne 0) {
        gh api --method PUT "repos/$repo/pages" -f build_type=workflow 1>$null 2>$null
    }

    Write-Host "A iniciar novamente a publicacao, agora com a chave configurada..."
    gh workflow run "Publicar Lisboa Falante em HTTPS" --repo $repo

    Write-Host ""
    Write-Host "REPOSITORIO CRIADO:" -ForegroundColor Green
    Write-Host "https://github.com/$repo"
    Write-Host ""
    Write-Host "ENDERECO HTTPS DO LISBOA FALANTE:" -ForegroundColor Green
    Write-Host "https://$login.github.io/lisboa-falante/"
    Write-Host ""
    Write-Host "A publicacao pode ainda estar a executar. Abra o separador Actions do repositorio para confirmar que terminou sem erro."
    Write-Host "Depois restrinja a chave Google Maps a este referenciador:" -ForegroundColor Yellow
    Write-Host "https://$login.github.io/lisboa-falante/*"

    Pausa-Final
}
catch {
    Write-Host ""
    Write-Host "ERRO: $($_.Exception.Message)" -ForegroundColor Red
    Pausa-Final
    exit 1
}
