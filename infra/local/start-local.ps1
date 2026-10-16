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

# 4. Optional temporary HTTPS tunnel (exposes ONLY the gateway, never the AzuraCast admin).
#    Tries a Cloudflare quick tunnel first; if that can't start (it times out on some connections),
#    falls back to localhost.run over SSH (built into Windows, no account, no install).
#    127.0.0.1 is used rather than "localhost", which can resolve to IPv6 (::1); the gateway listens on IPv4.
if ($Tunnel) {
  $url = $null
  $cf = (Get-Command cloudflared -ErrorAction SilentlyContinue).Source
  $default = 'C:\Program Files (x86)\cloudflared\cloudflared.exe' # winget install location (may not be on PATH yet)
  if (-not $cf -and (Test-Path $default)) { $cf = $default }
  if ($cf) {
    $log = Join-Path $env:TEMP 'sbradio-tunnel.log'
    for ($attempt = 1; $attempt -le 2 -and -not $url; $attempt++) {
      Remove-Item $log -ErrorAction SilentlyContinue
      $proc = Start-Process -WindowStyle Hidden -FilePath $cf -ArgumentList 'tunnel', '--no-autoupdate', '--url', 'http://127.0.0.1:8088' `
        -RedirectStandardError $log -PassThru
      for ($i = 0; $i -lt 45 -and -not $url -and -not $proc.HasExited; $i++) {
        Start-Sleep 1
        # skip api.trycloudflare.com, which appears in the log while the tunnel is being requested
        if (Test-Path $log) { $url = (Select-String -Path $log -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1).Matches.Value }
      }
      if (-not $url) { Write-Host "Cloudflare tunnel attempt $attempt failed"; if (-not $proc.HasExited) { Stop-Process -Id $proc.Id -Force } }
    }
  }
  if (-not $url) {
    Write-Host "Trying localhost.run instead..."
    $log = Join-Path $env:TEMP 'sbradio-lhr.log'
    Remove-Item $log -ErrorAction SilentlyContinue
    Start-Process -WindowStyle Hidden -FilePath ssh.exe -ArgumentList '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ServerAliveInterval=30',
      '-o', 'ExitOnForwardFailure=yes', '-R', '80:127.0.0.1:8088', 'nokey@localhost.run', '--', '--output', 'json' `
      -RedirectStandardOutput $log -RedirectStandardError ($log + '.err') | Out-Null
    for ($i = 0; $i -lt 30 -and -not $url; $i++) {
      Start-Sleep 1
      if (Test-Path $log) { $url = (Select-String -Path $log -Pattern 'https://[a-z0-9-]+\.lhr\.life' | Select-Object -First 1).Matches.Value }
    }
  }
  if ($url) { Write-Host "Tunnel (HTTPS, temporary): $url" }
  else { Write-Host "No tunnel could be started. Run this script again with -Tunnel, or use the same-Wi-Fi option." }
}

Write-Host ""
Write-Host "Admin (this PC only): http://localhost:18080"
Write-Host "Player (this PC)    : http://localhost:8088"
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet|WSL' -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1).IPAddress
Write-Host "Player (same Wi-Fi) : http://${ip}:8088   (needs the firewall rule in docs/stage2-local.md)"
