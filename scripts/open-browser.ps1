$ErrorActionPreference = "SilentlyContinue"
$url = "http://localhost:3220/#classement"
$deadline = (Get-Date).AddSeconds(90)

while ((Get-Date) -lt $deadline) {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:3220/" -TimeoutSec 2
        if ($response.StatusCode -eq 200) {
            Start-Process $url
            exit 0
        }
    } catch {
        Start-Sleep -Milliseconds 700
    }
}
