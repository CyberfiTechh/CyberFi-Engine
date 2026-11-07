param([Parameter(Mandatory = $true)][string]$EngineSource)
$ErrorActionPreference = 'Stop'
& node (Join-Path $PSScriptRoot '../branding/cli.mjs') win32 $EngineSource
if ($LASTEXITCODE -ne 0) { throw 'CyberFi Windows tray branding failed.' }