# Sayumi: wait until a local TCP port accepts connections. exit 0 when open
param([int]$Port = 8723, [int]$Tries = 20)
for ($i = 0; $i -lt $Tries; $i++) {
    try {
        $client = New-Object Net.Sockets.TcpClient
        $client.Connect('127.0.0.1', $Port)
        $client.Close()
        exit 0
    } catch {
        Start-Sleep -Milliseconds 400
    }
}
exit 1
