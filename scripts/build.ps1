[CmdletBinding()]
param(
    [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $ProjectRoot ".conda\python.exe"

if (-not (Test-Path -LiteralPath $Python -PathType Leaf)) {
    throw "Project Python environment is missing. Run .\scripts\bootstrap.ps1 first."
}

Push-Location $ProjectRoot
try {
    if (-not $SkipVerify) {
        & (Join-Path $PSScriptRoot "verify.ps1")
    }
    else {
        Push-Location (Join-Path $ProjectRoot "frontend")
        try {
            npm run build
        }
        finally {
            Pop-Location
        }
    }

    & $Python -m PyInstaller `
        --noconfirm `
        --clean `
        --distpath (Join-Path $ProjectRoot "release") `
        --workpath (Join-Path $ProjectRoot "build\pyinstaller") `
        (Join-Path $ProjectRoot "packaging\password-manager-v2.spec")

    $Executable = Join-Path $ProjectRoot "release\PasswordManagerV2\PasswordManagerV2.exe"
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw "PyInstaller completed without producing the expected executable."
    }
    & $Executable --smoke-test
    if ($LASTEXITCODE -ne 0) {
        throw "Packaged executable smoke test failed with exit code $LASTEXITCODE."
    }
}
finally {
    Pop-Location
}

Write-Host "Windows onedir build created at release\PasswordManagerV2."

