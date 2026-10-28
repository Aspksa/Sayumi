# Download into the caller's temporary path; throw on every unsuccessful outcome.
param([Parameter(Mandatory=$true)][string]$Url, [Parameter(Mandatory=$true)][string]$Out, [int]$Retries=3)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (([uri]$Url).Scheme -ne 'https') { throw 'HTTPS is required.' }
for ($i=1; $i -le $Retries; $i++) {
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing -TimeoutSec 120
        if (-not (Test-Path -LiteralPath $Out) -or (Get-Item -LiteralPath $Out).Length -eq 0) { throw 'Empty response.' }
        return
    } catch {
        if (Test-Path -LiteralPath $Out) { Remove-Item -LiteralPath $Out -Force }
        if ($i -eq $Retries) { throw }
        Start-Sleep -Seconds ($i*2)
    }
}
throw 'Download did not complete.'
