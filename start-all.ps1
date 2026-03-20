<#
.SYNOPSIS
  Concaretti — Start All Services
  Starts all 8 NestJS microservices and the Next.js web client in parallel.
  Each service opens in its own PowerShell window so logs stay separated.

.USAGE
  From the monorepo root: .\start-all.ps1
#>

param (
  [switch]$NoBrowser  # Pass -NoBrowser to skip auto-opening localhost:3000
)

$Root = $PSScriptRoot

# ── Service definitions ──────────────────────────────────────────────────────
$services = @(
  @{ Name = "Gateway";      Dir = "services\gateway";      Port = 3000 },
  @{ Name = "Orchestrator"; Dir = "services\orchestrator"; Port = 3001 },
  @{ Name = "Research";     Dir = "services\research";     Port = 3002 },
  @{ Name = "Email";        Dir = "services\email";        Port = 3003 },
  @{ Name = "File-Code";    Dir = "services\file-code";    Port = 3004 },
  @{ Name = "Chaos";        Dir = "services\chaos";        Port = 3005 },
  @{ Name = "Config";       Dir = "services\config";       Port = 3006 },
  @{ Name = "Auth";         Dir = "services\auth";         Port = 3007 }
)

$webApp = @{ Name = "Web Client"; Dir = "apps\web"; Command = "yarn dev" }

Write-Host ""
Write-Host "  ✦ CONCARETTI — Starting The Council ✦" -ForegroundColor Yellow
Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host ""

# ── Start each NestJS service in a new window ────────────────────────────────
foreach ($svc in $services) {
  $path = Join-Path $Root $svc.Dir
  if (-Not (Test-Path $path)) {
    Write-Host "  [SKIP] $($svc.Name) — directory not found: $path" -ForegroundColor DarkGray
    continue
  }

  $title  = "Concaretti · $($svc.Name) [:$($svc.Port)]"
  $cmd    = "cd '$path'; yarn start:dev"

  Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "`$host.UI.RawUI.WindowTitle = '$title'; cd '$path'; yarn start:dev" `
    -WindowStyle Normal

  Write-Host "  ▶ $($svc.Name)  (port $($svc.Port))" -ForegroundColor Cyan
  Start-Sleep -Milliseconds 300  # slight stagger to avoid port races
}

Write-Host ""

# ── Start Next.js web client ─────────────────────────────────────────────────
$webPath = Join-Path $Root $webApp.Dir
if (Test-Path $webPath) {
  Start-Process powershell -ArgumentList "-NoExit", "-Command", `
    "`$host.UI.RawUI.WindowTitle = 'Concaretti · Web Client [:3000]'; cd '$webPath'; yarn dev" `
    -WindowStyle Normal

  Write-Host "  ▶ Web Client  (http://localhost:3000)" -ForegroundColor Magenta
} else {
  Write-Host "  [SKIP] Web client — directory not found: $webPath" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "  ─────────────────────────────────────────" -ForegroundColor DarkGray
Write-Host "  All services launched. Check individual windows for logs." -ForegroundColor Green
Write-Host "  Ensure Redis is running on localhost:6379 before delegating." -ForegroundColor Yellow
Write-Host ""

# ── Optionally open browser ──────────────────────────────────────────────────
if (-Not $NoBrowser) {
  Start-Sleep -Seconds 4
  Write-Host "  Opening http://localhost:3000/dashboard..." -ForegroundColor DarkGray
  Start-Process "http://localhost:3000/dashboard"
}
