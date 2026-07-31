$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location $PSScriptRoot

function Titulo($texto) {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host " $texto"
    Write-Host "============================================================"
}

function Pausa-Autorizacao($mensagem) {
    Write-Host ""
    Write-Host $mensagem
    Read-Host "Depois de concluir no navegador, prima ENTER para continuar"
}

function Existe-Comando($nome) {
    return [bool](Get-Command $nome -ErrorAction SilentlyContinue)
}

function Instalar-Winget($id, $nome) {
    if (-not (Existe-Comando "winget")) {
        throw "O Windows Package Manager (winget) não está disponível. Instala o '$nome' manualmente e volta a executar."
    }
    Write-Host "A instalar $nome..."
    winget install --id $id -e --accept-source-agreements --accept-package-agreements
    if ($LASTEXITCODE -ne 0) { throw "Falhou a instalação de $nome." }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [Environment]::GetEnvironmentVariable("Path", "User")
}

Titulo "LISBOA FALANTE - PUBLICAÇÃO HTTPS"
Write-Host "Este processo cria uma ligação pública HTTPS que abre noutros computadores."
Write-Host "Só para quando é necessária uma autorização tua."
Write-Host "O repositório será privado e a chave Google não será enviada para o GitHub."

# 1. Confirmar chave
$envFile = Join-Path $PSScriptRoot "segredos\lisboa_falante.env"
if (-not (Test-Path $envFile)) {
    throw "Falta o ficheiro segredos\lisboa_falante.env."
}
$linhaChave = Get-Content $envFile | Where-Object { $_ -match '^\s*GOOGLE_MAPS_API_KEY\s*=' } | Select-Object -First 1
if (-not $linhaChave) { throw "Não encontrei GOOGLE_MAPS_API_KEY no ficheiro de segredos." }
$googleKey = ($linhaChave -split '=', 2)[1].Trim().Trim('"').Trim("'")
if ([string]::IsNullOrWhiteSpace($googleKey)) { throw "A chave Google Maps está vazia." }

# 2. Instalar Git e GitHub CLI apenas se faltarem
if (-not (Existe-Comando "git")) { Instalar-Winget "Git.Git" "Git" }
if (-not (Existe-Comando "gh")) { Instalar-Winget "GitHub.cli" "GitHub CLI" }

# 3. Login GitHub só se necessário
$authOk = $false
try {
    gh auth status 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) { $authOk = $true }
} catch {}
if (-not $authOk) {
    Titulo "AUTORIZAÇÃO GITHUB"
    Write-Host "Vai abrir o navegador para iniciares sessão e autorizares o GitHub CLI."
    gh auth login --hostname github.com --git-protocol https --web
    if ($LASTEXITCODE -ne 0) { throw "A autorização do GitHub não ficou concluída." }
}
gh auth setup-git | Out-Null

# 4. Preparar repositório local sem segredos
Titulo "PREPARAR O PROJETO"
if (-not (Test-Path ".git")) {
    git init -b main | Out-Null
}
git config user.name 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { git config user.name "Roberto" }
git config user.email 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) { git config user.email "roberto@users.noreply.github.com" }

git add server.py requirements.txt render.yaml README.md .gitignore templates static
$mudancas = git status --porcelain
if ($mudancas) {
    git commit -m "Publicar Lisboa Falante em HTTPS" | Out-Null
}

# 5. Criar ou reutilizar repositório privado
$repoName = "lisboa-falante-web"
$login = (gh api user --jq .login).Trim()
if (-not $login) { throw "Não consegui identificar a conta GitHub autorizada." }
$repoFull = "$login/$repoName"
$repoExiste = $false
gh repo view $repoFull 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { $repoExiste = $true }

if (-not $repoExiste) {
    Write-Host "A criar o repositório privado $repoFull..."
    gh repo create $repoName --private --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw "Não consegui criar o repositório GitHub." }
} else {
    Write-Host "O repositório privado já existe. Vou atualizá-lo."
    $remote = git remote get-url origin 2>$null
    if (-not $remote) { git remote add origin "https://github.com/$repoFull.git" }
    git push -u origin main
    if ($LASTEXITCODE -ne 0) { throw "Não consegui atualizar o repositório GitHub." }
}

# 6. Render: copiar segredo e abrir a página de criação
Titulo "AUTORIZAÇÃO RENDER"
Set-Clipboard -Value $googleKey
Write-Host "A chave Google Maps foi copiada para a área de transferência."
Write-Host "Na página do Render:"
Write-Host "1. Inicia sessão ou cria a conta."
Write-Host "2. Autoriza o acesso ao repositório privado lisboa-falante-web."
Write-Host "3. No campo GOOGLE_MAPS_API_KEY, cola com CTRL+V."
Write-Host "4. Confirma a criação do serviço."
$repoUrl = "https://github.com/$repoFull"
$deployUrl = "https://render.com/deploy?repo=" + [uri]::EscapeDataString($repoUrl)
Start-Process $deployUrl
Pausa-Autorizacao "Conclui a autorização e carrega em criar/aplicar no Render."

# 7. Abrir painéis e procurar ligação previsível
Titulo "PUBLICAÇÃO INICIADA"
$siteUrl = "https://lisboa-falante-roberto.onrender.com"
$dashboardUrl = "https://dashboard.render.com/"
Write-Host "O Render está agora a construir a aplicação."
Write-Host "Ligação prevista: $siteUrl"
Write-Host "Se o nome já estiver ocupado, o Render mostrará a ligação correta no painel."
Write-Host ""
Write-Host "Vou abrir o painel do Render e a ligação prevista."
Start-Process $dashboardUrl
Start-Sleep -Seconds 2
Start-Process $siteUrl

@"
LISBOA FALANTE - PUBLICAÇÃO HTTPS
Repositório privado: $repoUrl
Ligação prevista: $siteUrl
Painel Render: $dashboardUrl
Data: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

A chave Google Maps não foi enviada para o GitHub.
"@ | Set-Content -Encoding UTF8 "resultado_publicacao.txt"

Write-Host ""
Write-Host "Ficou guardado o ficheiro resultado_publicacao.txt com as ligações."
Write-Host "Na primeira publicação, o Render pode demorar alguns minutos a construir."
