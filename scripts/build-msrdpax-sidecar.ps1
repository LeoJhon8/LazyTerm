param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir "..\src-tauri\native\msrdpax-host\msrdpax-host.csproj"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "dotnet SDK was not found. Install .NET SDK 8 or newer, then rebuild msrdpax sidecar."
}

dotnet build $projectPath -c $Configuration