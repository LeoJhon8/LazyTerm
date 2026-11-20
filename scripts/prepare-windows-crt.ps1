$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Use only redistributable Release libraries, never DLLs from System32 or
# debug_nonredist. Ship the whole CRT set so native dependencies are covered too.
$redistRoots = @()
if ($env:VCToolsRedistDir) {
  $redistRoots += $env:VCToolsRedistDir
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
  $installations = @(& $vswhere -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
  if ($LASTEXITCODE -ne 0) { throw 'Unable to locate Visual Studio C++ redistributables.' }
  foreach ($installation in $installations) {
    $redistBase = Join-Path $installation 'VC\Redist\MSVC'
    if (Test-Path -LiteralPath $redistBase -PathType Container) {
      $redistRoots += @(Get-ChildItem -LiteralPath $redistBase -Directory | Select-Object -ExpandProperty FullName)
    }
  }
}

$candidates = @(foreach ($root in ($redistRoots | Select-Object -Unique)) {
  $x64Dir = Join-Path $root 'x64'
  if (-not (Test-Path -LiteralPath $x64Dir -PathType Container)) { continue }
  foreach ($crt in (Get-ChildItem -LiteralPath $x64Dir -Directory -Filter 'Microsoft.VC*.CRT')) {
    $runtime = Join-Path $crt.FullName 'vcruntime140.dll'
    if (Test-Path -LiteralPath $runtime -PathType Leaf) {
      $version = (Get-Item -LiteralPath $runtime).VersionInfo
      [pscustomobject]@{
        Directory = $crt.FullName
        Version = [version]::new($version.FileMajorPart, $version.FileMinorPart, $version.FileBuildPart, $version.FilePrivatePart)
      }
    }
  }
})
$selected = $candidates | Sort-Object Version -Descending | Select-Object -First 1
if (-not $selected) {
  throw 'No x64 VC++ CRT redistributables found. Install Visual Studio C++ Build Tools, or set VCToolsRedistDir to the MSVC redistributable version directory.'
}
foreach ($required in @('vcruntime140.dll', 'vcruntime140_1.dll', 'msvcp140.dll')) {
  if (-not (Test-Path -LiteralPath (Join-Path $selected.Directory $required) -PathType Leaf)) {
    throw "Incomplete VC++ CRT redistributables: $required is missing from $($selected.Directory)"
  }
}

$destination = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\src-tauri\native\vc-runtime\win-x64'))
New-Item -ItemType Directory -Force -Path $destination | Out-Null
# Delete only stale DLLs in this fixed, generated directory.
Get-ChildItem -LiteralPath $destination -File -Filter '*.dll' | Remove-Item -Force
Get-ChildItem -LiteralPath $selected.Directory -File -Filter '*.dll' |
  Copy-Item -Destination $destination -Force
Write-Host "Bundled x64 VC++ CRT $($selected.Version) from $($selected.Directory)"
