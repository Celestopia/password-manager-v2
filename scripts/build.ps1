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
            if ($LASTEXITCODE -ne 0) {
                throw "Frontend production build failed with exit code $LASTEXITCODE."
            }
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
    if ($LASTEXITCODE -ne 0) {
        throw "PyInstaller failed with exit code $LASTEXITCODE."
    }

    $Executable = Join-Path $ProjectRoot "release\PasswordManagerV2\PasswordManagerV2.exe"
    if (-not (Test-Path -LiteralPath $Executable -PathType Leaf)) {
        throw "PyInstaller completed without producing the expected executable."
    }
    $SmokeTest = Start-Process `
        -FilePath $Executable `
        -ArgumentList "--smoke-test" `
        -WindowStyle Hidden `
        -Wait `
        -PassThru
    if ($SmokeTest.ExitCode -ne 0) {
        throw "Packaged executable smoke test failed with exit code $($SmokeTest.ExitCode)."
    }

    if (-not ("PasswordManagerShellNotification" -as [type])) {
        Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public static class PasswordManagerShellNotification
{
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    public static extern void SHChangeNotify(
        uint eventId,
        uint flags,
        string item1,
        IntPtr item2
    );
}
"@
    }

    $ShellNotifyPath = 0x0005
    $ShellUpdateItem = 0x00002000
    $ShellUpdateDirectory = 0x00001000
    [PasswordManagerShellNotification]::SHChangeNotify(
        $ShellUpdateItem,
        $ShellNotifyPath,
        $Executable,
        [IntPtr]::Zero
    )
    [PasswordManagerShellNotification]::SHChangeNotify(
        $ShellUpdateDirectory,
        $ShellNotifyPath,
        (Split-Path -Parent $Executable),
        [IntPtr]::Zero
    )
}
finally {
    Pop-Location
}

Write-Host "Windows onedir build created at release\PasswordManagerV2; Windows Shell was notified to refresh its icon."
