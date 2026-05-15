param(
  [Parameter(Mandatory = $false)]
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Debug"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectPath = Join-Path $scriptDir "..\src-tauri\native\msrdpax-host\msrdpax-host.csproj"
$publishDir = Join-Path $scriptDir "..\src-tauri\native\msrdpax-host\publish\win-x64"

if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
  throw "dotnet SDK was not found. Install .NET SDK 8 or newer, then rebuild msrdpax sidecar."
}

if ($Configuration -eq "Release") {
  dotnet publish $projectPath `
    -c Release `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -p:IncludeNativeLibrariesForSelfExtract=true `
    -p:DebugType=None `
    -p:DebugSymbols=false `
    -o $publishDir
} else {
  dotnet build $projectPath -c $Configuration
}
