# Sayumi: enable "import site" in embeddable python _pth so pip works
param([string]$Dir)
$ErrorActionPreference = 'SilentlyContinue'
Get-ChildItem -LiteralPath $Dir -Filter 'python*._pth' | ForEach-Object {
    $lines = Get-Content -LiteralPath $_.FullName
    $out = @()
    foreach ($line in $lines) {
        if ($line.Trim() -eq '#import site') { $out += 'import site' }
        else { $out += $line }
    }
    if ($out -notcontains 'import site') { $out += 'import site' }
    if ($out -notcontains 'Lib\site-packages') { $out += 'Lib\site-packages' }
    Set-Content -LiteralPath $_.FullName -Value $out -Encoding ASCII
}
