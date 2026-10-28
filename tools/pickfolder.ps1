# Sayumi: native folder picker, prints chosen path or nothing
param([string]$Start = '')
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Windows.Forms | Out-Null
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = 'Sayumi: folder for data'
$dialog.ShowNewFolderButton = $true
if ($Start -and (Test-Path -LiteralPath $Start)) { $dialog.SelectedPath = $Start }
$result = $dialog.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK) { $dialog.SelectedPath }
