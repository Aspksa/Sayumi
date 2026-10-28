#requires -Version 5.1
param([string]$Action = '', [switch]$LibraryOnly)
$ErrorActionPreference = 'Stop'
$script:Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$script:ConfigPath = Join-Path $Root 'Sayumi.config.json'
$script:Config = @{ Language='RU'; Data=(Join-Path $Root 'data'); Port=8723; Python=''; Browser='default'; Window='app'; AutoClose='off'; Portable='auto' }
function Text($ru, $en) { if ($script:Config.Language -eq 'EN') { $en } else { $ru } }
function FullPath([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { throw 'Empty path.' }
    $full = [IO.Path]::GetFullPath($Path.Trim('"'))
    $base = [IO.Path]::GetPathRoot($full)
    if ($full.Length -eq $base.Length) { return $full }
    $full.TrimEnd([IO.Path]::DirectorySeparatorChar)
}
function SamePath($a, $b) { [string]::Equals((FullPath $a), (FullPath $b), [StringComparison]::OrdinalIgnoreCase) }
function NestedPath($a, $b) { (FullPath $a).StartsWith((FullPath $b).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) }
function ValidPort($Value) {
    $number = 0
    if (-not [int]::TryParse([string]$Value, [ref]$number) -or $number -lt 1 -or $number -gt 65535) { throw 'Port must be an integer between 1 and 65535.' }
    $number
}
function SaveConfig {
    $tmp = $ConfigPath + '.' + [guid]::NewGuid().ToString('N') + '.tmp'
    try {
        [IO.File]::WriteAllText($tmp, ($script:Config | ConvertTo-Json), (New-Object Text.UTF8Encoding($false)))
        if (Test-Path -LiteralPath $ConfigPath) { [IO.File]::Replace($tmp, $ConfigPath, [NullString]::Value) }
        else { [IO.File]::Move($tmp, $ConfigPath) }
    } finally { if (Test-Path -LiteralPath $tmp) { Remove-Item -LiteralPath $tmp -Force } }
}
function LoadConfig {
    if (Test-Path -LiteralPath $ConfigPath) {
        $saved = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        foreach ($key in @($script:Config.Keys)) { if ($null -ne $saved.$key) { $script:Config[$key] = $saved.$key } }
    } else {
        # Parse only literal assignments. Never execute the legacy CMD file.
        $legacy = Join-Path $Root 'Sayumi.config.cmd'
        $map = @{ OPT_LANG='Language'; OPT_DATA='Data'; OPT_PORT='Port'; OPT_PYTHON='Python'; OPT_BROWSER='Browser'; OPT_WINDOW='Window'; OPT_AUTOCLOSE='AutoClose'; OPT_PORTABLE='Portable' }
        if (Test-Path -LiteralPath $legacy) {
            foreach ($line in Get-Content -LiteralPath $legacy -Encoding UTF8) {
                if ($line -match '^set "(OPT_[A-Z]+)=(.*)"$' -and $map.ContainsKey($matches[1])) { $script:Config[$map[$matches[1]]] = $matches[2] }
            }
        }
    }
    $script:Config.Port = ValidPort $script:Config.Port
    $script:Config.Data = FullPath $script:Config.Data
}
function Health([int]$Port) {
    try {
        $request = [Net.WebRequest]::Create("http://127.0.0.1:$Port/api/health")
        $request.Proxy = $null; $request.Timeout = 1000
        $response = $request.GetResponse()
        try { $reader = New-Object IO.StreamReader($response.GetResponseStream()); try { $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() } }
        finally { $response.Dispose() }
    } catch { return $null }
}
function MatchesInstance($health) {
    $health -and $health.ok -eq $true -and $health.app -eq 'Sayumi' -and $health.root -and $health.data -and
        (SamePath $health.root $Root) -and (SamePath $health.data $script:Config.Data)
}
function FreePort([int]$First) {
    for ($port=$First; $port -le [Math]::Min(65535, $First+39); $port++) {
        $listener = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $port)
        try { $listener.Start(); return $port } catch { } finally { $listener.Stop() }
    }
    throw 'No available port in the selected range.'
}
function TestPython([string]$Exe) {
    if (-not $Exe -or -not (Test-Path -LiteralPath $Exe -PathType Leaf)) { return $false }
    try {
        $output = & $Exe -I -c "import sys,ssl,sqlite3,http.server,urllib.request,json,threading; assert sys.version_info >= (3,8); print('SAYUMI_PY_OK')" 2>$null
        return $LASTEXITCODE -eq 0 -and $output -contains 'SAYUMI_PY_OK'
    } catch { return $false }
}
function FindPython {
    $candidates = @($script:Config.Python, (Join-Path $Root 'runtime\python\python.exe'))
    $py = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($py) { try { $candidates += & $py.Source -3 -c 'import sys;print(sys.executable)' 2>$null } catch {} }
    foreach ($name in 'python.exe','python3.exe') {
        $candidates += @(Get-Command $name -All -ErrorAction SilentlyContinue | Where-Object Source -NotLike '*\WindowsApps\*' | Select-Object -ExpandProperty Source)
    }
    foreach ($key in 'HKCU:\Software\Python\PythonCore','HKLM:\Software\Python\PythonCore','HKLM:\Software\WOW6432Node\Python\PythonCore') {
        foreach ($version in Get-ChildItem -LiteralPath $key -ErrorAction SilentlyContinue) {
            $install = Get-ItemProperty -LiteralPath ($version.PSPath+'\InstallPath') -ErrorAction SilentlyContinue
            if ($install) { $candidates += $install.ExecutablePath }
        }
    }
    foreach ($base in @((Join-Path $env:LOCALAPPDATA 'Programs\Python'), $env:ProgramFiles, ${env:ProgramFiles(x86)}, 'C:\', 'D:\')) {
        if ($base) { $candidates += @(Get-ChildItem -LiteralPath $base -Directory -Filter 'Python3*' -ErrorAction SilentlyContinue | ForEach-Object { Join-Path $_.FullName 'python.exe' }) }
    }
    foreach ($candidate in $candidates | Select-Object -Unique) { if (TestPython $candidate) { return $candidate } }
    return $null
}
function Download([string]$Url, [string]$Destination) {
    $part = $Destination + '.' + [guid]::NewGuid().ToString('N') + '.part'
    try {
        & (Join-Path $PSScriptRoot 'fetch.ps1') -Url $Url -Out $part
        if (-not (Test-Path -LiteralPath $part) -or (Get-Item -LiteralPath $part).Length -eq 0) { throw 'Empty download.' }
        Move-Item -LiteralPath $part -Destination $Destination -Force
    } finally { if (Test-Path -LiteralPath $part) { Remove-Item -LiteralPath $part -Force } }
}
function InstallPython([switch]$System) {
    $version = '3.12.7'
    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { 'win32' }
    $runtime = Join-Path $Root 'runtime'
    [IO.Directory]::CreateDirectory($runtime) | Out-Null
    $stage = Join-Path $runtime ('install-'+[guid]::NewGuid().ToString('N'))
    [IO.Directory]::CreateDirectory($stage) | Out-Null
    try {
        if ($System) {
            $suffix = if ($arch -eq 'win32') { '' } else { '-'+$arch }
            $name = "python-$version$suffix.exe"
            $installer = Join-Path $stage $name
            Download "https://www.python.org/ftp/python/$version/$name" $installer
            if ((Get-AuthenticodeSignature -LiteralPath $installer).Status -ne 'Valid') { throw 'Python installer signature is invalid.' }
            $process = Start-Process -FilePath $installer -ArgumentList '/quiet InstallAllUsers=0 PrependPath=1 Include_pip=0 Include_test=0' -Wait -PassThru
            if ($process.ExitCode -notin 0,3010) { throw "Python installer failed: $($process.ExitCode)" }
            $python = FindPython
            if (-not $python) { throw 'Installation finished but no compatible Python was found. Restart the launcher.' }
        } else {
            $zip = Join-Path $stage 'python.zip'
            Download "https://www.python.org/ftp/python/$version/python-$version-embed-$arch.zip" $zip
            $unpacked = Join-Path $stage 'python'
            Expand-Archive -LiteralPath $zip -DestinationPath $unpacked
            $python = Join-Path $unpacked 'python.exe'
            if ((Get-AuthenticodeSignature -LiteralPath $python).Status -ne 'Valid') { throw 'Python executable signature is invalid.' }
            if (-not (TestPython $python)) { throw 'Downloaded Python failed its compatibility check.' }
            $target = Join-Path $runtime 'python'
            PromoteRuntime $unpacked $target
            # Keep the previous runtime as a recoverable backup.
            $python = Join-Path $target 'python.exe'
        }
        $script:Config.Python = $python; SaveConfig
        return $python
    } finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
}
function QuoteArg([string]$Value) {
    # Windows argv quoting: double trailing backslashes before the closing quote.
    if ($Value.Contains('"')) { throw 'Double quote is not valid in a Windows path.' }
    '"' + [regex]::Replace($Value, '(\\+)$', '$1$1') + '"'
}
function Browser([string]$Url) {
    $names = switch ($script:Config.Browser) { 'chrome' { @('Google\Chrome\Application\chrome.exe') } 'msedge' { @('Microsoft\Edge\Application\msedge.exe') } 'firefox' { @('Mozilla Firefox\firefox.exe') } default { @('Google\Chrome\Application\chrome.exe','Microsoft\Edge\Application\msedge.exe','BraveSoftware\Brave-Browser\Application\brave.exe','Chromium\Application\chrome.exe') } }
    if ($script:Config.Window -eq 'tab' -and $script:Config.Browser -eq 'default') { Start-Process $Url; return }
    foreach ($base in @($env:LOCALAPPDATA, $env:ProgramFiles, ${env:ProgramFiles(x86)})) {
        if (-not $base) { continue }
        foreach ($name in $names) {
            $exe = Join-Path $base $name
            if (Test-Path -LiteralPath $exe) {
                $args = QuoteArg $Url
                if ($script:Config.Window -eq 'app' -and $script:Config.Browser -ne 'firefox') { $args = '--app='+$args+' --window-size=1280,880' }
                Start-Process -FilePath $exe -ArgumentList $args; return
            }
        }
    }
    Start-Process $Url
}
function AfterRun([string]$Url) {
    Write-Host (Text "Сервер отвечает. Адрес: $Url" "Server ready. Address: $Url")
    if ($script:Config.AutoClose -eq 'on') { return }
    while ($true) {
        Write-Host (Text 'O Открыть снова | B Обычная вкладка | L Журналы | M Меню | Z Закрыть лаунчер (сервер продолжит работу)' 'O Open again | B Browser tab | L Logs | M Menu | Z Close launcher (server stays running)')
        switch ((Read-Host '>').ToUpperInvariant()) {
            'O' { Browser $Url }
            'B' { $previous=$script:Config.Window; try { $script:Config.Window='tab'; Browser $Url } finally { $script:Config.Window=$previous } }
            'L' { Start-Process explorer.exe -ArgumentList (QuoteArg (Join-Path $Root 'logs')) }
            'M' { return }
            'Z' { exit 0 }
        }
    }
}
function RunApp {
    $python = FindPython
    if (-not $python) { $python = InstallPython }
    if (-not (Test-Path -LiteralPath (Join-Path $Root 'web\index.html'))) { throw 'Missing web/index.html.' }
    if (MatchesInstance (Health $script:Config.Port)) { Browser "http://127.0.0.1:$($script:Config.Port)/"; AfterRun "http://127.0.0.1:$($script:Config.Port)/"; return }
    $port = FreePort (ValidPort $script:Config.Port)
    [IO.Directory]::CreateDirectory($script:Config.Data) | Out-Null
    $logs = Join-Path $Root 'logs'; [IO.Directory]::CreateDirectory($logs) | Out-Null
    $id = [guid]::NewGuid().ToString('N')
    $args = @((QuoteArg (Join-Path $Root 'server\server.py')), '--port', $port, '--root', (QuoteArg $Root), '--data', (QuoteArg $script:Config.Data), '--no-pick-port') -join ' '
    $process = Start-Process -FilePath $python -ArgumentList $args -WorkingDirectory $Root -WindowStyle Minimized -RedirectStandardOutput (Join-Path $logs "$id.out.log") -RedirectStandardError (Join-Path $logs "$id.err.log") -PassThru
    for ($i=0; $i -lt 40; $i++) {
        $process.Refresh()
        if ($process.HasExited) { throw "Server exited ($($process.ExitCode)). See $logs\$id.err.log" }
        if (MatchesInstance (Health $port)) { $script:Config.Port=$port; SaveConfig; Browser "http://127.0.0.1:$port/"; AfterRun "http://127.0.0.1:$port/"; return }
        Start-Sleep -Milliseconds 250
    }
    if (-not $process.HasExited) { $process.Kill() }
    throw "Server readiness timed out. See $logs\$id.err.log"
}
function AssertStopped {
    # The launcher persists the active port. Also detect servers started manually on another port.
    $running = @(Get-CimInstance Win32_Process -Filter "name = 'python.exe' OR name = 'pythonw.exe' OR name = 'python3.exe'" | Where-Object { $_.CommandLine -and ($_.CommandLine.IndexOf((Join-Path $Root 'server\server.py'), [StringComparison]::OrdinalIgnoreCase) -ge 0 -or $_.CommandLine -match '(?i)(?:^|[ "])(?:\.\)?server[\\/]server\.py(?:[ " ]|$)') })
    if ((MatchesInstance (Health $script:Config.Port)) -or $running.Count) { throw 'Stop this Sayumi server before copying or changing data folders.' }
}
function AssertPlainPath([string]$Path) {
    $current = FullPath $Path
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Linked paths are not supported for copying: $current" }
        }
        $current = Split-Path -Parent $current
    }
}
function PromoteRuntime([string]$Staged, [string]$Target) {
    $backup = $Target + '-backup-' + [guid]::NewGuid().ToString('N')
    $hadOld = Test-Path -LiteralPath $Target
    if ($hadOld) { [IO.Directory]::Move($Target, $backup) }
    try { [IO.Directory]::Move($Staged, $Target) }
    catch { if ($hadOld) { [IO.Directory]::Move($backup, $Target) }; throw }
}
function CopyVerified([string]$Source, [string]$Destination) {
    [IO.Directory]::CreateDirectory($Destination) | Out-Null
    foreach ($item in Get-ChildItem -LiteralPath $Source -Force) {
        if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Links are not copied: $($item.FullName)" }
        $out = Join-Path $Destination $item.Name
        if ($item.PSIsContainer) { CopyVerified $item.FullName $out }
        else {
            Copy-Item -LiteralPath $item.FullName -Destination $out
            if ((Get-FileHash -LiteralPath $item.FullName).Hash -ne (Get-FileHash -LiteralPath $out).Hash) { throw "Copy verification failed: $out" }
        }
    }
}
function CopyTransaction([string]$Source, [string]$Destination, [switch]$Deploy) {
    $Source=FullPath $Source; $Destination=FullPath $Destination
    if ((SamePath $Source $Destination) -or (NestedPath $Source $Destination) -or (NestedPath $Destination $Source)) { throw 'Source and destination must not overlap.' }
    AssertPlainPath $Source; AssertPlainPath $Destination
    if ($Deploy) {
        AssertPlainPath $script:Config.Data
        if ((SamePath $script:Config.Data $Destination) -or (NestedPath $Destination $script:Config.Data) -or (NestedPath $script:Config.Data $Destination)) { throw 'Deployment destination must not overlap the selected data folder.' }
    }
    $wasEmpty = Test-Path -LiteralPath $Destination
    if ($wasEmpty -and (-not (Test-Path -LiteralPath $Destination -PathType Container) -or @(Get-ChildItem -LiteralPath $Destination -Force).Count)) { throw 'Choose a new or empty destination; existing files are never overwritten.' }
    $parent = Split-Path -Parent $Destination
    [IO.Directory]::CreateDirectory($parent) | Out-Null
    $stage = Join-Path $parent ('.sayumi-copy-'+[guid]::NewGuid().ToString('N'))
    try {
        [IO.Directory]::CreateDirectory($stage) | Out-Null
        if ($Deploy) {
            foreach ($directory in 'web','server','tools') { CopyVerified (Join-Path $Source $directory) (Join-Path $stage $directory) }
            foreach ($file in 'Sayumi.bat','README.md') {
                Copy-Item -LiteralPath (Join-Path $Source $file) -Destination (Join-Path $stage $file)
                if ((Get-FileHash -LiteralPath (Join-Path $Source $file)).Hash -ne (Get-FileHash -LiteralPath (Join-Path $stage $file)).Hash) { throw "Copy verification failed: $file" }
            }
            if (Test-Path -LiteralPath $script:Config.Data) { CopyVerified $script:Config.Data (Join-Path $stage 'data') }
            # Include only the active portable runtime, never absolute-path configuration or caches.
            if (Test-Path -LiteralPath (Join-Path $Source 'runtime\python')) { CopyVerified (Join-Path $Source 'runtime\python') (Join-Path $stage 'runtime\python') }
            [IO.File]::WriteAllText((Join-Path $stage 'portable.flag'), 'sayumi portable')
        } elseif (Test-Path -LiteralPath $Source) { CopyVerified $Source $stage }
        if ($wasEmpty) { [IO.Directory]::Delete($Destination, $false) } # Fails safely if another process added files.
        try { [IO.Directory]::Move($stage, $Destination) }
        catch { if ($wasEmpty -and -not (Test-Path -LiteralPath $Destination)) { [IO.Directory]::CreateDirectory($Destination) | Out-Null }; throw }
    } finally { if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force } }
}
function ChangeData([string]$Destination) {
    $Destination=FullPath $Destination
    if (SamePath $Destination $script:Config.Data) { return }
    AssertStopped
    CopyTransaction $script:Config.Data $Destination
    $oldData=$script:Config.Data; $oldPortable=$script:Config.Portable
    try { $script:Config.Data=$Destination; $script:Config.Portable='off'; SaveConfig }
    catch { $script:Config.Data=$oldData; $script:Config.Portable=$oldPortable; throw }
}
function FolderMenu {
    Write-Host (Text '1 Выбрать в проводнике  2 Ввести путь  3 Рядом с программой  4 Документы  0 Назад' '1 Browse  2 Enter path  3 Next to application  4 Documents  0 Back')
    $path = switch (Read-Host '>') {
        '1' { & (Join-Path $PSScriptRoot 'pickfolder.ps1') -Start $script:Config.Data }
        '2' { Read-Host (Text 'Новая или пустая папка' 'New or empty folder') }
        '3' { Join-Path $Root 'data' }
        '4' { Join-Path ([Environment]::GetFolderPath('MyDocuments')) 'Sayumi' }
    }
    if ($path) { ChangeData $path }
}
function PythonMenu {
    Write-Host (Text '1 Найти  2 Переносимый Python  3 Системный Python  4 Указать путь  0 Назад' '1 Find  2 Portable Python  3 System Python  4 Set path  0 Back')
    switch (Read-Host '>') {
        '1' { Write-Host (FindPython) }
        '2' { InstallPython | Out-Host }
        '3' { InstallPython -System | Out-Host }
        '4' { $path=Read-Host 'python.exe'; if (-not (TestPython $path)) { throw 'Python 3.8+ with the required standard-library modules is required.' }; $script:Config.Python=$path; SaveConfig }
    }
}
function OptionsMenu {
    Write-Host (Text '1 Порт  2 Браузер  3 Окно/вкладка  4 Переносимый режим  5 Данные  6 Логи  7 Сброс  8 Закрывать лаунчер автоматически' '1 Port  2 Browser  3 Window/tab  4 Portable mode  5 Data  6 Logs  7 Reset  8 Auto-close launcher')
    switch (Read-Host '>') {
        '1' { $script:Config.Port=ValidPort (Read-Host 'Port'); SaveConfig }
        '2' { $b=Read-Host 'default / chrome / msedge / firefox'; if ($b -notin 'default','chrome','msedge','firefox') { throw 'Unknown browser.' }; $script:Config.Browser=$b; SaveConfig }
        '3' { $script:Config.Window=if ($script:Config.Window -eq 'app') {'tab'} else {'app'}; SaveConfig }
        '4' { if ($script:Config.Portable -eq 'on') { $script:Config.Portable='off' } else { ChangeData (Join-Path $Root 'data'); $script:Config.Portable='on' }; SaveConfig }
        '5' { Start-Process explorer.exe -ArgumentList (QuoteArg $script:Config.Data) }
        '6' { Start-Process explorer.exe -ArgumentList (QuoteArg (Join-Path $Root 'logs')) }
        '8' { $script:Config.AutoClose=if ($script:Config.AutoClose -eq 'on') {'off'} else {'on'}; SaveConfig }
        '7' { if ((Read-Host 'Reset? Y/N') -eq 'Y') { foreach ($name in 'Sayumi.config.json','Sayumi.config.cmd') { $p=Join-Path $Root $name; if (Test-Path -LiteralPath $p) { Move-Item -LiteralPath $p -Destination ($p+'.backup-'+[guid]::NewGuid().ToString('N')) } }; exit 0 } }
    }
}
function Menu {
    while ($true) {
        Write-Host "`nSayumi | $Root | $($script:Config.Data) | $($script:Config.Port)"
        Write-Host (Text '1 Запустить  2 Диск  3 Папка данных  4 Python  5 Настройки  6 Развернуть копию  7 Диагностика  8 RU/EN  0 Выход' '1 Start  2 Drive  3 Data folder  4 Python  5 Settings  6 Deploy copy  7 Diagnostics  8 RU/EN  0 Exit')
        try {
            switch (Read-Host '>') {
                '0' { return }
                '1' { RunApp }
                '2' { Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID,DriveType,VolumeName,FreeSpace | Format-Table | Out-Host; $drive=Read-Host 'Drive (E:)'; if ($drive -notmatch '^[A-Za-z]:$') { throw 'Expected drive letter, for example E:' }; ChangeData (Join-Path ($drive+'\') 'Sayumi\data') }
                '3' { FolderMenu }
                '4' { PythonMenu }
                '5' { OptionsMenu }
                '6' { AssertStopped; $target=Read-Host (Text 'Новая папка для копии' 'New folder for the copy'); CopyTransaction $Root $target -Deploy; Write-Host (Text 'Копия проверена и готова.' 'Copy verified and ready.') }
                '7' { Write-Host "PowerShell $($PSVersionTable.PSVersion)"; Write-Host (FindPython); Health $script:Config.Port | Format-List | Out-Host; Write-Host (Join-Path $Root 'logs') }
                '8' { $script:Config.Language=if ($script:Config.Language -eq 'RU') {'EN'} else {'RU'}; SaveConfig }
            }
        } catch { Write-Host $_.Exception.Message -ForegroundColor Red }
    }
}
if ($LibraryOnly) { return }
try {
    if ([Environment]::OSVersion.Version.Major -lt 10) { throw 'Windows 10 or newer is required for automatic Python installation.' }
    LoadConfig
    $driveType = & (Join-Path $PSScriptRoot 'drivetype.ps1') -Drive ([IO.Path]::GetPathRoot($Root))
    if ($script:Config.Portable -eq 'auto') {
        if (((Test-Path -LiteralPath (Join-Path $Root 'portable.flag')) -or $driveType -eq 2) -and (SamePath $script:Config.Data (Join-Path $Root 'data'))) { $script:Config.Portable='on' } else { $script:Config.Portable='off' }
    }
    if ($script:Config.Portable -eq 'on' -and -not (SamePath $script:Config.Data (Join-Path $Root 'data'))) {
        throw 'Portable mode conflicts with the configured data folder. Move the data explicitly before enabling portable mode.'
    }
    switch ($Action.ToLowerInvariant()) {
        { $_ -in '/help','/?','-h' } { Write-Host 'Sayumi.bat [/run | /menu | /setup | /help]'; exit 0 }
        { $_ -in '/menu','-menu' } { Menu; exit 0 }
        '/setup' { PythonMenu; exit 0 }
        { $_ -in '/run','-run' } { RunApp; if ($script:Config.AutoClose -ne 'on') { Menu }; exit 0 }
        '' {
            Write-Host (Text 'Запуск через 3 секунды. Нажмите M для меню.' 'Starting in 3 seconds. Press M for menu.')
            & choice.exe /c MZ /n /t 3 /d Z | Out-Null
            if ($LASTEXITCODE -eq 1) { Menu } else { RunApp; if ($script:Config.AutoClose -ne 'on') { Menu } }
        }
        default { throw 'Unknown argument. Use /help.' }
    }
} catch { Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 }
