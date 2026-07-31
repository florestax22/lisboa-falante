$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Falar([string]$texto) {
    try {
        Add-Type -AssemblyName System.Speech
        $voz = New-Object System.Speech.Synthesis.SpeechSynthesizer
        $voz.Speak($texto)
        $voz.Dispose()
    } catch {}
}

function Parar-E-Esperar([string]$mensagem) {
    Write-Host ""
    Write-Host $mensagem
    Falar $mensagem
    Write-Host ""
    Read-Host "Prima Enter para fechar"
    exit 1
}

try {
    Write-Host ""
    Write-Host "============================================================"
    Write-Host " LISBOA FALANTE - HTTPS PARA O TELEMOVEL"
    Write-Host "============================================================"
    Write-Host ""

    $envFile = Join-Path $PSScriptRoot "segredos\lisboa_falante.env"
    if (-not (Test-Path $envFile)) {
        Parar-E-Esperar "ERRO: falta o ficheiro segredos\lisboa_falante.env"
    }

    if (Get-Command py -ErrorAction SilentlyContinue) {
        $python = "py"
        $pythonArgs = @("-3")
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        $python = "python"
        $pythonArgs = @()
    } else {
        Parar-E-Esperar "ERRO: Python nao encontrado."
    }

    Write-Host "A instalar ou confirmar os componentes da aplicacao..."
    & $python @pythonArgs -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) {
        Parar-E-Esperar "ERRO: falhou a instalacao do Flask."
    }

    $cloudflared = Join-Path $PSScriptRoot "cloudflared.exe"
    if (-not (Test-Path $cloudflared)) {
        Write-Host "A baixar o Cloudflare Tunnel oficial..."
        $download = "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe"
        Invoke-WebRequest -Uri $download -OutFile $cloudflared -UseBasicParsing
    }

    if (-not (Test-Path $cloudflared)) {
        Parar-E-Esperar "ERRO: cloudflared.exe nao foi encontrado nem baixado."
    }

    $serverOut = Join-Path $PSScriptRoot "servidor_saida.log"
    $serverErr = Join-Path $PSScriptRoot "servidor_erros.log"
    $tunnelOut = Join-Path $PSScriptRoot "tunel_saida.log"
    $tunnelErr = Join-Path $PSScriptRoot "tunel_erros.log"
    Remove-Item $serverOut,$serverErr,$tunnelOut,$tunnelErr -Force -ErrorAction SilentlyContinue

    Write-Host "A iniciar a Lisboa Falante..."
    $serverArguments = @()
    $serverArguments += $pythonArgs
    $serverArguments += "server.py"

    $server = Start-Process -FilePath $python `
        -ArgumentList $serverArguments `
        -WorkingDirectory $PSScriptRoot `
        -RedirectStandardOutput $serverOut `
        -RedirectStandardError $serverErr `
        -PassThru `
        -WindowStyle Hidden

    Start-Sleep -Seconds 5

    try {
        Invoke-WebRequest -Uri "http://127.0.0.1:5000" -UseBasicParsing -TimeoutSec 10 | Out-Null
    } catch {
        Write-Host ""
        Write-Host "O servidor nao arrancou."
        if (Test-Path $serverErr) { Get-Content $serverErr }
        if (Test-Path $serverOut) { Get-Content $serverOut }
        if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
        Parar-E-Esperar "ERRO: a Lisboa Falante nao arrancou."
    }

    Write-Host "A criar a ligacao HTTPS..."
    $tunnel = Start-Process -FilePath $cloudflared `
        -ArgumentList @("tunnel","--url","http://127.0.0.1:5000","--no-autoupdate") `
        -WorkingDirectory $PSScriptRoot `
        -RedirectStandardOutput $tunnelOut `
        -RedirectStandardError $tunnelErr `
        -PassThru `
        -WindowStyle Hidden

    $link = $null
    for ($i = 0; $i -lt 90; $i++) {
        Start-Sleep -Seconds 1
        $conteudo = ""
        if (Test-Path $tunnelOut) {
            $conteudo += Get-Content $tunnelOut -Raw -ErrorAction SilentlyContinue
        }
        if (Test-Path $tunnelErr) {
            $conteudo += "`n" + (Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue)
        }

        $resultado = [regex]::Match($conteudo, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com')
        if ($resultado.Success) {
            $link = $resultado.Value
            break
        }

        if ($tunnel.HasExited) { break }
        Write-Host -NoNewline "."
    }
    Write-Host ""

    if (-not $link) {
        Write-Host "Nao foi criado nenhum endereco HTTPS."
        if (Test-Path $tunnelErr) { Get-Content $tunnelErr }
        if (Test-Path $tunnelOut) { Get-Content $tunnelOut }
        if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
        if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
        Parar-E-Esperar "ERRO: nao consegui criar a ligacao HTTPS."
    }

    Set-Clipboard -Value $link
    (Join-Path $PSScriptRoot "LINK_HTTPS.txt") | ForEach-Object {
        Set-Content -Path $_ -Value $link -Encoding UTF8
    }

    Write-Host ""
    Write-Host "============================================================"
    Write-Host " LIGACAO PRONTA"
    Write-Host "============================================================"
    Write-Host ""
    Write-Host $link
    Write-Host ""
    Write-Host "O link foi copiado e guardado no ficheiro LINK_HTTPS.txt."
    Write-Host "Nao feches esta janela nem desligues o computador."
    Write-Host ""
    Falar "Ligacao pronta. O link foi copiado e guardado no ficheiro link HTTPS."
    Start-Process $link

    Read-Host "Quando voltares do teste, prime Enter para desligar"
    if ($tunnel -and -not $tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
    if ($server -and -not $server.HasExited) { Stop-Process -Id $server.Id -Force }
    Write-Host "Aplicacao desligada."
    Falar "Aplicacao desligada."
}
catch {
    Write-Host ""
    Write-Host "ERRO INESPERADO:"
    Write-Host $_.Exception.Message
    Write-Host ""
    Falar "Ocorreu um erro. A janela vai ficar aberta para poderes ler."
    Read-Host "Prima Enter para fechar"
}
