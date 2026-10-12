<#
.SYNOPSIS
    Build and minify script for LinkedIn Learning Java site.
.DESCRIPTION
    Runs Zola build with --minify, then deeply minifies CSS, JS, JSON, SVG, XML with minify.exe.
.EXAMPLE
    .\build.ps1
#>

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Write-Host "🔨 Building and minifying static site via CMake..." -ForegroundColor Cyan
cmake -P "$scriptDir/build.cmake"
exit $LASTEXITCODE
