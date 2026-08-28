[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".conda\python.exe"
$FrontendPath = Join-Path $ProjectRoot "frontend"

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Project Python environment is missing. Run .\scripts\bootstrap.ps1 first."
}

Push-Location $ProjectRoot
try {
    & $Python -m ruff check src tests
    & $Python -m mypy
    & $Python -m pytest
    & $Python -m password_manager_desktop --smoke-test

    Push-Location $FrontendPath
    try {
        npm run typecheck
        npm run lint
        npm run test:run
        npm run build
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}

Write-Host "All verification checks passed."

