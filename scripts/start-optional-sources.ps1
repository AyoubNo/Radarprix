$ErrorActionPreference = "SilentlyContinue"
$projectRoot = Split-Path -Parent $PSScriptRoot
$projectsParent = Split-Path -Parent $projectRoot
$desktop = [Environment]::GetFolderPath("Desktop")
$node = (Get-Command node).Source

$sources = @(
    @{
        Port = 3300
        Folders = @(
            (Join-Path $projectsParent "comparateur-pc-maroc"),
            (Join-Path $desktop "comparateur-pc-maroc")
        )
    },
    @{
        Port = 3400
        Folders = @(
            (Join-Path $projectsParent "comparateur-electromenager-maroc"),
            (Join-Path $desktop "comparateur-electromenager-maroc")
        )
    }
)

function Test-SourceApi([int]$port) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 1
        return $response.StatusCode -eq 200
    } catch {
        return $false
    }
}

foreach ($source in $sources) {
    if (Test-SourceApi $source.Port) {
        Write-Host "Source de donnees $($source.Port) deja active."
        continue
    }

    $folder = $source.Folders | Where-Object { Test-Path (Join-Path $_ "server\api-server.mjs") } | Select-Object -First 1
    if (-not $folder) {
        Write-Host "Source $($source.Port) absente : la copie locale incluse sera utilisee."
        continue
    }

    Start-Process -FilePath $node `
        -ArgumentList "server/api-server.mjs" `
        -WorkingDirectory $folder `
        -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $folder ".prixradar-source.stdout.log") `
        -RedirectStandardError (Join-Path $folder ".prixradar-source.stderr.log")

    $deadline = (Get-Date).AddSeconds(25)
    while ((Get-Date) -lt $deadline -and -not (Test-SourceApi $source.Port)) {
        Start-Sleep -Milliseconds 500
    }

    if (Test-SourceApi $source.Port) {
        Write-Host "Source de donnees $($source.Port) demarree."
    } else {
        Write-Host "Source $($source.Port) indisponible : la copie locale incluse sera utilisee."
    }
}
