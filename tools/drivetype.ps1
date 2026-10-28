# Sayumi: print DriveType number for a drive letter like  C:
param([string]$Drive = 'C:')
$ErrorActionPreference = 'SilentlyContinue'
$d = $Drive.TrimEnd('\')
$disk = Get-CimInstance Win32_LogicalDisk | Where-Object { $_.DeviceID -eq $d }
if (-not $disk) { $disk = Get-WmiObject Win32_LogicalDisk | Where-Object { $_.DeviceID -eq $d } }
if ($disk) { $disk.DriveType } else { 0 }
