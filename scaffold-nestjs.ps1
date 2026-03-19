$services = @(
  @{ name = "gateway"; port = 3000 },
  @{ name = "orchestrator"; port = 3001 },
  @{ name = "research"; port = 3002 },
  @{ name = "email"; port = 3003 },
  @{ name = "file-code"; port = 3004 },
  @{ name = "chaos"; port = 3005 },
  @{ name = "config"; port = 3006 },
  @{ name = "auth"; port = 3007 }
)

cd "c:\Users\Admin\Desktop\The Council\concaretti"

foreach ($s in $services) {
    Write-Host ""
    Write-Host "Scaffolding $($s.name)..." -ForegroundColor Cyan
    $dir = "services\$($s.name)"
    if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
    npx -y @nestjs/cli new $($s.name) --directory $dir --skip-git --skip-install --package-manager yarn
    
    $mainPath = "$dir\src\main.ts"
    if (Test-Path $mainPath) {
        $content = Get-Content -Raw $mainPath
        # NestJS > 10.x default listen string is "process.env.PORT ?? 3000" or just "3000"
        $content = $content -replace 'process\.env\.PORT \?\? 3000', $($s.port)
        $content = $content -replace 'await app\.listen\(3000\)', "await app.listen($($s.port))"
        Set-Content -Path $mainPath -Value $content -Encoding utf8
    } else {
        Write-Host "Warning: $mainPath not found" -ForegroundColor Yellow
    }
}
Write-Host "Scaffolding Complete" -ForegroundColor Green
