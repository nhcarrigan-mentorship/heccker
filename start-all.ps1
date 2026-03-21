# $ErrorActionPreference = "Stop"
$env:NODE_OPTIONS = "--max-old-space-size=4096"

$EnvFilePath = Join-Path -Path $PWD -ChildPath ".env"

if (Test-Path $EnvFilePath) {
    Write-Host "Loading environment variables from .env..." -ForegroundColor Green
    foreach ($line in Get-Content $EnvFilePath) {
        $line = $line.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }
        
        $split = $line.Split("=", 2)
        if ($split.Length -eq 2) {
            $name = $split[0].Trim()
            $value = $split[1].Trim()
            
            # Remove edge quotes if any
            if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Trim('"') }
            elseif ($value.StartsWith("'") -and $value.EndsWith("'")) { $value = $value.Trim("'") }
            
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
} else {
    Write-Host "WARNING: .env file not found at $EnvFilePath" -ForegroundColor Yellow
}

$services = @(
    @{ Name = "Gatekeeper"; Path = "services\gateway"; Command = "yarn.cmd start:dev" },
    @{ Name = "Orchestrator"; Path = "services\orchestrator"; Command = "yarn.cmd start:dev" },
    @{ Name = "Research"; Path = "services\research"; Command = "yarn.cmd start:dev" },
    @{ Name = "Email"; Path = "services\email"; Command = "yarn.cmd start:dev" },
    @{ Name = "File-Code"; Path = "services\file-code"; Command = "yarn.cmd start:dev" },
    @{ Name = "Chaos"; Path = "services\chaos"; Command = "yarn.cmd start:dev" },
    @{ Name = "Config"; Path = "services\config"; Command = "yarn.cmd start:dev" },
    @{ Name = "Auth"; Path = "services\auth"; Command = "yarn.cmd start:dev" },
    @{ Name = "GitHub Agent"; Path = "services\github"; Command = "yarn.cmd start:dev" },
    @{ Name = "News Agent"; Path = "services\news"; Command = "yarn.cmd start:dev" },
    @{ Name = "Scheduler Agent"; Path = "services\scheduler"; Command = "yarn.cmd start:dev" },
    @{ Name = "Web Dashboard"; Path = "apps\web"; Command = "yarn.cmd dev" }
)

Write-Host "Starting The Council (Concaretti)..." -ForegroundColor Cyan

foreach ($svc in $services) {
    $svcPath = Join-Path -Path $PWD -ChildPath $svc.Path
    if (-Not (Test-Path $svcPath)) {
        Write-Host "Skipping $($svc.Name) - Path not found: $($svc.Path)" -ForegroundColor Red
        continue
    }

    Write-Host "Starting $($svc.Name) in a new window..." -ForegroundColor Cyan
    
    # Force copy the root .env file into the service directory so NestJS natively finds it
    if (Test-Path $EnvFilePath) {
        Copy-Item -Path $EnvFilePath -Destination (Join-Path $svcPath ".env") -Force
    }

    # We pass the loaded environment variables to the new window by starting it from this process
    Start-Process powershell -ArgumentList "-NoExit -Command `"Set-Location '$svcPath'; Write-Host 'Starting $($svc.Name)...' -ForegroundColor Green; $($svc.Command)`"" -WindowStyle Normal
}

Write-Host "All services have been launched in separate windows!" -ForegroundColor Green
