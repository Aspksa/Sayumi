# Run on Windows PowerShell 5.1+ or PowerShell 7. Tests use only temporary folders.
$ErrorActionPreference='Stop'
. (Join-Path $PSScriptRoot '..\tools\launcher.ps1') -LibraryOnly
$passed=0
function Check($condition, $message) { if (-not $condition) { throw $message }; $script:passed++ }
function Reject([scriptblock]$operation, $message) {
    $failed=$false
    try { & $operation | Out-Null } catch { $failed=$true }
    Check $failed $message
}
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('sayumi-launcher-'+[guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($testRoot) | Out-Null
try {
    foreach ($port in 1,8723,65535) { Check ((ValidPort $port) -eq $port) 'Valid port rejected.' }
    foreach ($port in '',0,-1,65536,'abc','8723 & echo unsafe','1.5') { Reject { ValidPort $port } 'Invalid port accepted.' }
    $source=Join-Path $testRoot "source ! & O'Brien [1]"
    [IO.Directory]::CreateDirectory((Join-Path $source 'nested')) | Out-Null
    [IO.File]::WriteAllText((Join-Path $source 'nested\note.txt'), 'original data')
    $dest=Join-Path $testRoot "copy ! & O'Brien [1]"
    CopyTransaction $source $dest
    Check ((Get-Content -LiteralPath (Join-Path $dest 'nested\note.txt') -Raw) -eq 'original data') 'Copy content differs.'
    Check (Test-Path -LiteralPath (Join-Path $source 'nested\note.txt')) 'Source was removed.'
    Reject { CopyTransaction $source $dest } 'Existing destination was overwritten.'
    Reject { CopyTransaction $source $source } 'Identical paths accepted.'
    Reject { CopyTransaction $source (Join-Path $source 'child') } 'Nested destination accepted.'
    Reject { CopyTransaction $source $testRoot } 'Ancestor destination accepted.'
    Check (SamePath $source ($source+[IO.Path]::DirectorySeparatorChar)) 'Trailing slash comparison failed.'
    $script:Root=$source; $script:ConfigPath=Join-Path $source 'Sayumi.config.json'
    $script:Config.Data=$dest
    $script:Config.Python="C:\O'Brien ! & %PATH%\python.exe"
    SaveConfig; SaveConfig
    $script:Config.Data='wrong'; LoadConfig
    Check (SamePath $script:Config.Data $dest) 'JSON config roundtrip failed.'
    Check ($script:Config.Python -eq "C:\O'Brien ! & %PATH%\python.exe") 'Config expanded special characters.'
    Check (MatchesInstance @{ok=$true;app='Sayumi';root=$source;data=$dest}) 'Matching server rejected.'
    Check (-not (MatchesInstance @{ok=$true;app='Sayumi';root=$source;data=$source})) 'Wrong data directory accepted.'
    Check (-not (MatchesInstance @{ok=$true;app='Sayumi';root=$dest;data=$dest})) 'Wrong checkout accepted.'
    Check (-not (MatchesInstance @{ok=$false;app='Sayumi';root=$source;data=$dest})) 'Unhealthy server accepted.'
    # Legacy configuration is parsed, never executed.
    Remove-Item -LiteralPath $ConfigPath
    [IO.File]::WriteAllText((Join-Path $source 'Sayumi.config.cmd'), "set `"OPT_PORT=9001`"`nset `"OPT_DATA=$dest`"`necho MUST_NOT_EXECUTE")
    LoadConfig
    Check ($script:Config.Port -eq 9001) 'Legacy config was not migrated.'
    $repo=Join-Path $testRoot 'repo'
    foreach ($dir in 'web','server','tools','runtime\python') { [IO.Directory]::CreateDirectory((Join-Path $repo $dir)) | Out-Null; [IO.File]::WriteAllText((Join-Path $repo "$dir\fixture.txt"),'fixture') }
    foreach ($file in 'Sayumi.bat','README.md','Sayumi.config.json') { [IO.File]::WriteAllText((Join-Path $repo $file),'fixture') }
    Reject { CopyTransaction $repo (Join-Path $dest 'inside-data') -Deploy } 'Deployment inside external data accepted.'
    $deployment=Join-Path $testRoot 'deployment'
    CopyTransaction $repo $deployment -Deploy
    Check (Test-Path -LiteralPath (Join-Path $deployment 'runtime\python\fixture.txt')) 'Portable runtime missing.'
    Check (Test-Path -LiteralPath (Join-Path $deployment 'data\nested\note.txt')) 'Selected data missing.'
    Check (Test-Path -LiteralPath (Join-Path $deployment 'portable.flag')) 'Portable flag missing.'
    Check (-not (Test-Path -LiteralPath (Join-Path $deployment 'Sayumi.config.json'))) 'Absolute config copied.'
    # Missing required deployment files must not publish a partial destination.
    Remove-Item -LiteralPath (Join-Path $repo 'Sayumi.bat')
    $bad=Join-Path $testRoot 'failed-deployment'
    Reject { CopyTransaction $repo $bad -Deploy } 'Incomplete deployment reported success.'
    Check (-not (Test-Path -LiteralPath $bad)) 'Partial deployment published.'
    Check (@(Get-ChildItem -LiteralPath $testRoot -Force -Filter '.sayumi-copy-*').Count -eq 0) 'Staging folders leaked.'
    $empty=Join-Path $testRoot 'empty-destination'
    [IO.Directory]::CreateDirectory($empty) | Out-Null
    CopyTransaction $source $empty
    Check (Test-Path -LiteralPath (Join-Path $empty 'nested\note.txt')) 'Empty destination failed.'
    $oldRuntime=Join-Path $testRoot 'runtime'
    [IO.Directory]::CreateDirectory($oldRuntime) | Out-Null
    [IO.File]::WriteAllText((Join-Path $oldRuntime 'python.exe'),'old runtime')
    Reject { PromoteRuntime (Join-Path $testRoot 'missing-stage') $oldRuntime } 'Missing staged runtime accepted.'
    Check ((Get-Content -LiteralPath (Join-Path $oldRuntime 'python.exe') -Raw) -eq 'old runtime') 'Old runtime lost after failed replacement.'
    $newRuntime=Join-Path $testRoot 'new-runtime'
    [IO.Directory]::CreateDirectory($newRuntime) | Out-Null
    [IO.File]::WriteAllText((Join-Path $newRuntime 'python.exe'),'new runtime')
    PromoteRuntime $newRuntime $oldRuntime
    Check ((Get-Content -LiteralPath (Join-Path $oldRuntime 'python.exe') -Raw) -eq 'new runtime') 'Runtime replacement failed.'
    Check (@(Get-ChildItem -LiteralPath $testRoot -Directory -Filter 'runtime-backup-*').Count -eq 1) 'Previous runtime backup missing.'
    $listener=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
    try {
        $listener.Start()
        $busy=$listener.LocalEndpoint.Port
        if ($busy -lt 65535) { Check ((FreePort $busy) -gt $busy) 'Busy port selected.' }
    } finally { $listener.Stop() }
    Check (-not (TestPython (Join-Path $testRoot 'missing-python.exe'))) 'Missing Python accepted.'
    # Real fetch helper must delete a partial file when the transport fails.
    function Invoke-WebRequest { param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec); [IO.File]::WriteAllText($OutFile,'partial'); throw 'Simulated network failure' }
    $partial=Join-Path $testRoot 'download.part'
    Reject { & (Join-Path $PSScriptRoot '..\tools\fetch.ps1') -Url 'https://example.com/file' -Out $partial -Retries 1 } 'Failed download reported success.'
    Check (-not (Test-Path -LiteralPath $partial)) 'Partial download retained.'
    Write-Host "Launcher: $passed checks passed. Windows process/browser/installer integration still requires Windows."
} finally { Remove-Item -LiteralPath $testRoot -Recurse -Force }
