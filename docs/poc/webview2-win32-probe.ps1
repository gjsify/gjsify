# SPDX-License-Identifier: MIT
#
# Builds and runs `webview2-win32-probe.cpp` — ADR 0035's spike.
#
# Runs on a stock `windows-latest` runner and on a Windows workstation with
# Visual Studio (or the Build Tools) installed. It resolves the toolchain rather
# than assuming a shell has already been initialised, because the two hosts
# differ there and a probe that only works inside a Developer Prompt is a probe
# nobody runs twice.
#
#   pwsh -File docs/poc/webview2-win32-probe.ps1
#
# Exit codes are the probe's own (see the tail of the .cpp): 0 = the expected
# shape, 10 = no loop bridge needed (which invalidates part of ADR 0035), 11 =
# no frame captured, 2/3/4 = the probe could not measure.

[CmdletBinding()]
param(
    # A probe input, pinned like every other version in this repo: an unpinned
    # SDK makes two runs of the same probe two different measurements.
    [string]$WebView2Version = '1.0.2903.40',
    [string]$OutDir = (Join-Path ([IO.Path]::GetTempPath()) 'gjsify-webview2-probe')
)

$ErrorActionPreference = 'Stop'
$probeSource = Join-Path $PSScriptRoot 'webview2-win32-probe.cpp'
if (-not (Test-Path $probeSource)) {
    throw "probe source not found beside this script: $probeSource"
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

# ---------------------------------------------------------------- 1. the SDK
# The WebView2 SDK is a NuGet package and nothing else — there is no system
# location for it, so the probe fetches its own copy. `nuget.exe` is present on
# GitHub's windows images; on a workstation it may not be.
$nuget = (Get-Command nuget.exe -ErrorAction SilentlyContinue)?.Source
if (-not $nuget) {
    $nuget = Join-Path $OutDir 'nuget.exe'
    if (-not (Test-Path $nuget)) {
        Write-Host 'fetching nuget.exe'
        Invoke-WebRequest -UseBasicParsing `
            -Uri 'https://dist.nuget.org/win-x86-commandline/latest/nuget.exe' `
            -OutFile $nuget
    }
}

$packages = Join-Path $OutDir 'packages'
$sdk = Join-Path $packages "Microsoft.Web.WebView2.$WebView2Version"
if (-not (Test-Path $sdk)) {
    Write-Host "installing Microsoft.Web.WebView2 $WebView2Version"
    & $nuget install Microsoft.Web.WebView2 -Version $WebView2Version `
        -OutputDirectory $packages -NonInteractive | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "nuget install failed ($LASTEXITCODE)" }
}
$include = Join-Path $sdk 'build\native\include'
$libDir = Join-Path $sdk 'build\native\x64'
foreach ($p in @($include, $libDir)) {
    if (-not (Test-Path $p)) { throw "the SDK layout is not what this script expects: $p is absent" }
}

# ---------------------------------------------------------------- 2. the toolchain
# `cl.exe` only works with the environment `vcvars64.bat` sets, and that is a
# batch file: the portable way to get it into PowerShell is to run it and read
# the resulting environment back out. vswhere ships with VS since 2017 and is at
# a fixed location.
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (-not (Test-Path $vswhere)) { throw "vswhere.exe not found — is Visual Studio (or the Build Tools) installed?" }
    $vsRoot = & $vswhere -latest -products '*' `
        -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
        -property installationPath
    if (-not $vsRoot) { throw 'vswhere found no installation carrying the x64 C++ toolset' }
    $vcvars = Join-Path $vsRoot 'VC\Auxiliary\Build\vcvars64.bat'
    if (-not (Test-Path $vcvars)) { throw "vcvars64.bat missing under $vsRoot" }

    Write-Host "importing the MSVC environment from $vsRoot"
    & cmd.exe /c "call `"$vcvars`" >nul 2>&1 && set" | ForEach-Object {
        if ($_ -match '^([^=]+)=(.*)$') {
            Set-Item -Path "env:$($matches[1])" -Value $matches[2] -ErrorAction SilentlyContinue
        }
    }
}
if (-not (Get-Command cl.exe -ErrorAction SilentlyContinue)) {
    throw 'cl.exe is still not on PATH after importing the MSVC environment'
}

# ---------------------------------------------------------------- 3. compile
# WebView2LoaderStatic.lib is chosen over the DLL deliberately: the probe is one
# file that a reader copies to a machine and runs, and a loader DLL beside it is
# one more thing to get wrong. `version.lib` is what the static loader needs to
# read the runtime's version, and it is the link error people hit first.
$exe = Join-Path $OutDir 'webview2-win32-probe.exe'
Push-Location $OutDir
try {
    & cl.exe /nologo /std:c++17 /EHsc /W3 /MD `
        "/I$include" $probeSource `
        "/Fe:$exe" `
        /link "/LIBPATH:$libDir" `
        WebView2LoaderStatic.lib ole32.lib oleaut32.lib user32.lib shlwapi.lib version.lib advapi32.lib | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "cl.exe failed ($LASTEXITCODE)" }
}
finally {
    Pop-Location
}

# ---------------------------------------------------------------- 4. run
# No redirection: the probe's stdout IS the measurement, and a `| Tee-Object`
# here would make $LASTEXITCODE the pipeline's rather than the probe's — the
# same class of mistake as reading a shell pipeline's exit code as the program's.
Write-Host ''
& $exe
$rc = $LASTEXITCODE
Write-Host ''
Write-Host "probe exit code: $rc"
exit $rc
