param(
  [Parameter(Mandatory = $false)]
  [string]$RepoUrl = "https://github.com/LibVNC/libvncserver.git",

  [Parameter(Mandatory = $false)]
  [string]$SourceDir = "C:\dev\libvncserver",

  [Parameter(Mandatory = $false)]
  [string]$BuildDir,

  [Parameter(Mandatory = $false)]
  [string]$InstallDir,

  [Parameter(Mandatory = $false)]
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release",

  [Parameter(Mandatory = $false)]
  [string]$Generator = "Auto",

  [Parameter(Mandatory = $false)]
  [ValidateSet("x64", "Win32", "ARM64")]
  [string]$Platform = "x64",

  [Parameter(Mandatory = $false)]
  [string]$VcpkgRoot,

  [Parameter(Mandatory = $false)]
  [switch]$Clean,

  [Parameter(Mandatory = $false)]
  [switch]$SkipGitPull,

  [Parameter(Mandatory = $false)]
  [switch]$PersistUserEnvironment,

  [Parameter(Mandatory = $false)]
  [switch]$EnableOpenSSL,

  [Parameter(Mandatory = $false)]
  [switch]$EnableCompressionDeps
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Require-Command {
  param(
    [string]$Name,
    [string]$Hint
  )

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name not found. $Hint"
  }
}

function Invoke-Step {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Description
  )

  Write-Step $Description
  Write-Host "$FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath $($Arguments -join ' ')"
  }
}

function Ensure-Directory {
  param([string]$Path)

  if (-not (Test-Path $Path)) {
    New-Item -ItemType Directory -Path $Path | Out-Null
  }
}

function Resolve-VcpkgExecutable {
  param([string]$Root)

  if ([string]::IsNullOrWhiteSpace($Root)) {
    return $null
  }

  $exePath = Join-Path $Root "vcpkg.exe"
  if (-not (Test-Path $exePath)) {
    throw "vcpkg.exe was not found under VcpkgRoot: $exePath"
  }

  return $exePath
}

function Get-CMakeGeneratorList {
  $helpText = & cmake --help | Out-String
  return $helpText
}

function Resolve-VsDevCmd {
  $candidates = @(
    "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\18\Professional\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\18\Enterprise\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\17\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\17\Professional\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\17\Enterprise\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\Tools\VsDevCmd.bat",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\Tools\VsDevCmd.bat"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $candidate
    }
  }

  return $null
}

function Test-VisualStudio2022Installed {
  $candidates = @(
    "C:\Program Files\Microsoft Visual Studio\17\Community\Common7\IDE\devenv.exe",
    "C:\Program Files\Microsoft Visual Studio\17\Professional\Common7\IDE\devenv.exe",
    "C:\Program Files\Microsoft Visual Studio\17\Enterprise\Common7\IDE\devenv.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\devenv.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Professional\Common7\IDE\devenv.exe",
    "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\Common7\IDE\devenv.exe"
  )

  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) {
      return $true
    }
  }

  return $false
}

function Get-VisualStudioGeneratorCandidate {
  $helpText = Get-CMakeGeneratorList
  if ($helpText -match "Visual Studio 17 2022") {
    return "Visual Studio 17 2022"
  }

  if ($helpText -match "Visual Studio 18 2026") {
    return "Visual Studio 18 2026"
  }

  return $null
}

function Get-PlatformDevCmdArch {
  param([string]$TargetPlatform)

  switch ($TargetPlatform) {
    "Win32" { return "x86" }
    "ARM64" { return "arm64" }
    default { return "x64" }
  }
}

function Join-CmdArguments {
  param([string[]]$Arguments)

  return ($Arguments | ForEach-Object {
    if ($_ -match '[\s"]') {
      '"' + ($_ -replace '"', '\"') + '"'
    } else {
      $_
    }
  }) -join ' '
}

function Invoke-InDevShell {
  param(
    [string]$VsDevCmd,
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Description,
    [string]$Arch
  )

  Write-Step $Description
  $joinedArgs = Join-CmdArguments -Arguments $Arguments
  Write-Host "$FilePath $joinedArgs" -ForegroundColor DarkGray

  $commandLine = 'call "' + $VsDevCmd + '" -no_logo -arch=' + $Arch + ' -host_arch=' + $Arch + ' >nul && "' + $FilePath + '" ' + $joinedArgs
  & cmd.exe /d /c $commandLine
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath $joinedArgs"
  }
}

if ([string]::IsNullOrWhiteSpace($BuildDir)) {
  $BuildDir = Join-Path $SourceDir "build-msvc"
}

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
  $InstallDir = Join-Path $SourceDir "install"
}

$vcpkgExe = Resolve-VcpkgExecutable -Root $VcpkgRoot
$useVcpkgToolchain = $false
$resolvedGenerator = $Generator
$vsDevCmd = Resolve-VsDevCmd
$useDevShell = $false
$devCmdArch = Get-PlatformDevCmdArch -TargetPlatform $Platform

Require-Command -Name git -Hint "Install Git first."
Require-Command -Name cmake -Hint "Install CMake first and make sure it is in PATH."

Write-Step "Checking source directory"
if (-not (Test-Path $SourceDir)) {
  $parentDir = Split-Path -Parent $SourceDir
  if (-not [string]::IsNullOrWhiteSpace($parentDir)) {
    Ensure-Directory -Path $parentDir
  }

  Invoke-Step -FilePath git -Arguments @("clone", $RepoUrl, $SourceDir) -Description "Cloning libvncserver source"
} elseif (-not $SkipGitPull) {
  Invoke-Step -FilePath git -Arguments @("-C", $SourceDir, "pull", "--ff-only") -Description "Updating libvncserver source"
}

if ($Clean -and (Test-Path $BuildDir)) {
  Write-Step "Cleaning previous build directory"
  Remove-Item -Recurse -Force $BuildDir
}

Ensure-Directory -Path $BuildDir
Ensure-Directory -Path $InstallDir

if ($resolvedGenerator -eq "Auto") {
  $visualStudioGenerator = Get-VisualStudioGeneratorCandidate
  $hasVs2022 = Test-VisualStudio2022Installed

  if ($visualStudioGenerator -eq "Visual Studio 17 2022" -and $hasVs2022) {
    $resolvedGenerator = $visualStudioGenerator
  } elseif ($vsDevCmd) {
    $resolvedGenerator = "Ninja Multi-Config"
    $useDevShell = $true
  } else {
    throw "No supported Visual Studio generator was found in CMake, and VsDevCmd.bat was not found for a Ninja fallback."
  }
} elseif (($resolvedGenerator -like "Visual Studio *") -and -not (Get-CMakeGeneratorList).Contains($resolvedGenerator) -and $vsDevCmd) {
  $resolvedGenerator = "Ninja Multi-Config"
  $useDevShell = $true
}

$cmakeArgs = @(
  "--fresh",
  "-S", $SourceDir,
  "-B", $BuildDir,
  "-G", $resolvedGenerator,
  "-DCMAKE_INSTALL_PREFIX=$InstallDir",
  "-DWITH_GNUTLS=OFF",
  "-DWITH_ZLIB=OFF",
  "-DWITH_JPEG=OFF",
  "-DWITH_PNG=OFF",
  "-DWITH_SDL=OFF",
  "-DWITH_GTK=OFF",
  "-DWITH_EXAMPLES=OFF",
  "-DWITH_TESTS=OFF",
  "-DWITH_OPENSSL=OFF",
  "-DWITH_GCRYPT=OFF"
)

if ($resolvedGenerator -like "Visual Studio *") {
  $cmakeArgs += @("-A", $Platform)
}

if ($EnableOpenSSL -or $EnableCompressionDeps) {
  if (-not $vcpkgExe) {
    throw "Optional dependencies were requested, but -VcpkgRoot was not provided. Pass VcpkgRoot or disable EnableOpenSSL / EnableCompressionDeps."
  }

  if ($Platform -eq "Win32") {
    $triplet = "x86-windows"
  } elseif ($Platform -eq "ARM64") {
    $triplet = "arm64-windows"
  } else {
    $triplet = "x64-windows"
  }

  $deps = New-Object System.Collections.Generic.List[string]
  if ($EnableOpenSSL) {
    $deps.Add("openssl:$triplet")
    $cmakeArgs = $cmakeArgs | Where-Object { $_ -ne "-DWITH_OPENSSL=OFF" }
    $cmakeArgs += "-DWITH_OPENSSL=ON"
  }

  if ($EnableCompressionDeps) {
    $deps.Add("zlib:$triplet")
    $deps.Add("libpng:$triplet")
    $deps.Add("libjpeg-turbo:$triplet")
    $cmakeArgs = $cmakeArgs | Where-Object { $_ -notin @("-DWITH_ZLIB=OFF", "-DWITH_JPEG=OFF", "-DWITH_PNG=OFF") }
    $cmakeArgs += "-DWITH_ZLIB=ON"
    $cmakeArgs += "-DWITH_JPEG=ON"
    $cmakeArgs += "-DWITH_PNG=ON"
  }

  if ($deps.Count -gt 0) {
    $vcpkgArgs = @("install") + $deps.ToArray()
    Invoke-Step -FilePath $vcpkgExe -Arguments $vcpkgArgs -Description "Installing optional dependencies via vcpkg"
  }

  $toolchainFile = Join-Path $VcpkgRoot "scripts\buildsystems\vcpkg.cmake"
  if (-not (Test-Path $toolchainFile)) {
    throw "vcpkg toolchain file was not found: $toolchainFile"
  }

  $cmakeArgs += "-DCMAKE_TOOLCHAIN_FILE=$toolchainFile"
  $cmakeArgs += "-DVCPKG_TARGET_TRIPLET=$triplet"
  $useVcpkgToolchain = $true
}

if ($useDevShell) {
  Require-Command -Name ninja -Hint "Install Ninja first, or use a CMake version that supports your Visual Studio generator directly."
  Invoke-InDevShell -VsDevCmd $vsDevCmd -FilePath "cmake" -Arguments $cmakeArgs -Description "Configuring libvncserver MSVC build" -Arch $devCmdArch
  Invoke-InDevShell -VsDevCmd $vsDevCmd -FilePath "cmake" -Arguments @("--build", $BuildDir, "--config", $Configuration) -Description "Building libvncserver" -Arch $devCmdArch
  Invoke-InDevShell -VsDevCmd $vsDevCmd -FilePath "cmake" -Arguments @("--install", $BuildDir, "--config", $Configuration) -Description "Installing libvncserver" -Arch $devCmdArch
} else {
  Invoke-Step -FilePath cmake -Arguments $cmakeArgs -Description "Configuring libvncserver MSVC build"
  Invoke-Step -FilePath cmake -Arguments @("--build", $BuildDir, "--config", $Configuration) -Description "Building libvncserver"
  Invoke-Step -FilePath cmake -Arguments @("--install", $BuildDir, "--config", $Configuration) -Description "Installing libvncserver"
}

$expectedHeader = Join-Path $InstallDir "include\rfb\rfbclient.h"
$expectedLibrary = Join-Path $InstallDir "lib\vncclient.lib"

Write-Step "Validating installation"
if (-not (Test-Path $expectedHeader)) {
  throw "Header file was not found: $expectedHeader"
}

if (-not (Test-Path $expectedLibrary)) {
  Write-Warning "Expected library was not found at $expectedLibrary. Check the install directory under lib or bin."
}

if ($PersistUserEnvironment) {
  Write-Step "Persisting user environment variable"
  setx LIBVNCSERVER_ROOT $InstallDir | Out-Null
  Write-Host "User environment variable written: LIBVNCSERVER_ROOT=$InstallDir" -ForegroundColor Green
}

Write-Step "Done"
$env:LIBVNCSERVER_ROOT = $InstallDir
Write-Host "Install directory: $InstallDir" -ForegroundColor Green
Write-Host "Environment variable required by this project:" -ForegroundColor Green
Write-Host "  `$env:LIBVNCSERVER_ROOT = '$InstallDir'" -ForegroundColor Yellow

if ($useVcpkgToolchain) {
  Write-Host "This build used the vcpkg toolchain." -ForegroundColor Green
}

Write-Host "Resolved generator: $resolvedGenerator" -ForegroundColor Green

if ($useDevShell -and $vsDevCmd) {
  Write-Host "Developer shell bootstrap: $vsDevCmd" -ForegroundColor Green
}

Write-Host "Then run in the same terminal: npm run tauri dev" -ForegroundColor Yellow