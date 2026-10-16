# LOCAL DEVELOPMENT ONLY - starts the whole local Street Blackjack Radio stack.
#   powershell -ExecutionPolicy Bypass -File D:\radio\infra\local\start-local.ps1
# Optional:  -Tunnel   also starts a temporary Cloudflare HTTPS tunnel to the gateway (player + audio only)
param([switch]$Tunnel)
$ErrorActionPreference = 'Stop'
$Distro = 'Ubuntu-24.04'
$Repo = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# 1. Keep the WSL distro running (WSL stops idle distros; AzuraCast must run 24/7).
$keep = Get-CimInstance Win32_Process -Filter "Name='wsl.exe'" | Where-Object { $_.CommandLine -match "$Distro.*sleep infinity" }
if (-not $keep) {
  Start-Process -WindowStyle Hidden -FilePath wsl.exe -ArgumentList '-d', $Distro, '-u', 'root', '--', 'sleep', 'infinity' | Out-Null
  Write-Host "WSL keep-alive started"
}

# 2. AzuraCast + registry (inside WSL)
wsl -d $Distro -u root -- bash -c "cd /root/azuracast && docker compose up -d && cd /mnt/d/radio/infra/local && docker compose -f compose.local.yml up -d"

# 3. Gateway on Windows (player + registry + audio only)
$gw = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'gateway\.mjs' }
if (-not $gw) {
  Start-Process -WindowStyle Hidden -FilePath node -ArgumentList "$Repo\infra\local\gateway.mjs" `
    -RedirectStandardOutput "$env:TEMP\sbradio-gateway.log" -RedirectStandardError "$env:TEMP\sbradio-gateway.err" | Out-Null
  Write-Host "Gateway started on port 8088"
}

# 4. Optional temporary HTTPS tunnel (exposes ONLY the gateway, never the AzuraCast admin)
if ($Tunnel) {
  if (-not (Get-Command cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared is not installed (see docs/stage2-local.md)" }
  $log = "$env:TEMP\sbradio-tunnel.log"
  Remove-Item $log -ErrorAction SilentlyContinue
  Start-Process -WindowStyle Hidden -FilePath cloudflared -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://localhost:8088' `
    -RedirectStandardError $log | Out-Null
  $url = $null
  for ($i = 0; $i -lt 30 -and -not $url; $i++) {
    Start-Sleep 1
    if (Test-Path $log) { $url = (Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1).Matches.Value }
  }
  Write-Host "Tunnel (HTTPS, temporary): $url"
}

Write-Host ""
Write-Host "Admin (this PC only): http://localhost:18080"
Write-Host "Player (this PC)    : http://localhost:8088"
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Write-Host "Player (same Wi-Fi) : http://${ip}:8088   (needs the firewall rule in docs/stage2-local.md)"
