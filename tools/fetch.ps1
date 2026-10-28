# Sayumi: download a file with retries. exit 0 on success
param([string]$Url, [string]$Out, [int]$Retries = 3)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 -bor [Net.SecurityProtocolType]::Tls11
} catch { }
for ($i = 1; $i -le $Retries; $i++) {
    try {
        Invoke-WebRequest -Uri $Url -OutFile $Out -UseBasicParsing
        if (Test-Path -LiteralPath $Out) { exit 0 }
    } catch {
        Write-Host ("attempt {0} failed: {1}" -f $i, $_.Exception.Message)
        Start-Sleep -Seconds ($i * 2)
    }
}
try {
    (New-Object Net.WebClient).DownloadFile($Url, $Out)
    if (Test-Path -LiteralPath $Out) { exit 0 }
} catch { }
exit 1
