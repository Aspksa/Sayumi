# Sayumi: list logical drives as  ID;TYPE;LABEL;FREE_GB
$ErrorActionPreference = 'SilentlyContinue'
try {
    $disks = Get-CimInstance Win32_LogicalDisk
} catch {
    $disks = $null
}
if (-not $disks) {
    try { $disks = Get-WmiObject Win32_LogicalDisk } catch { $disks = $null }
}
if (-not $disks) {
    foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
        $id = $d.Name.TrimEnd('\')
        $free = 0
        try { $free = [math]::Round($d.AvailableFreeSpace / 1GB, 1) } catch { }
        $label = ''
        try { $label = $d.VolumeLabel } catch { }
        $type = 0
        switch ($d.DriveType) {
            'Removable' { $type = 2 }
            'Fixed'     { $type = 3 }
            'Network'   { $type = 4 }
            'CDRom'     { $type = 5 }
            default     { $type = 6 }
        }
        '{0};{1};{2};{3}' -f $id, $type, ($label -replace ';', ' '), $free
    }
    exit 0
}
foreach ($d in $disks) {
    $free = 0
    if ($d.FreeSpace) { $free = [math]::Round($d.FreeSpace / 1GB, 1) }
    $label = ''
    if ($d.VolumeName) { $label = ($d.VolumeName -replace ';', ' ') }
    '{0};{1};{2};{3}' -f $d.DeviceID, $d.DriveType, $label, $free
}
