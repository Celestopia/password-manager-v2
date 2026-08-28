[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$EnvironmentPath = Join-Path $ProjectRoot ".conda"
$FrontendPath = Join-Path $ProjectRoot "frontend"
$NpmCachePath = Join-Path $FrontendPath ".npm-cache"

Push-Location $ProjectRoot
try {
    if (Test-Path -LiteralPath $EnvironmentPath) {
        conda env update --prefix $EnvironmentPath --file environment.yml --prune
    }
    else {
        conda env create --prefix $EnvironmentPath --file environment.yml
    }

    Push-Location $FrontendPath
    try {
        npm ci --cache $NpmCachePath
    }
    finally {
        Pop-Location
    }
}
finally {
    Pop-Location
}

Write-Host "Project-local Python and frontend dependencies are ready."

