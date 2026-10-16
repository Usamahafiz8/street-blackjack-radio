# LOCAL DEVELOPMENT ONLY - stops the tunnel and gateway, and (with -All) AzuraCast and the registry.
#   powershell -ExecutionPolicy Bypass -File D:\radio\infra\local\stop-local.ps1 [-All]
param([switch]$All)
$Distro = 'Ubuntu-24.04'

Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" | Where-Object { $_.CommandLine -match 'localhost:8088' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Tunnel stopped" }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'gateway\.mjs' } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "Gateway stopped" }

if ($All) {
  wsl -d $Distro -u root -- bash -c "cd /mnt/d/radio/infra/local && docker compose -f compose.local.yml stop; cd /root/azuracast && docker compose stop"
  Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match "$Distro.*sleep infinity" } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force; Write-Host "WSL keep-alive stopped" }
}
