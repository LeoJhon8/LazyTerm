param(
  [Parameter(Mandatory = $false)]
  [string]$LibVncSourceDir = "C:\dev\libvncserver",

  [Parameter(Mandatory = $false)]
  [string]$LibVncInstallDir = "C:\dev\libvncserver\install",

  [Parameter(Mandatory = $false)]
  [string]$LibVncRef = "LibVNCServer-0.9.14",

  [Parameter(Mandatory = $false)]
  [switch]$SkipPackageInstall,

  [Parameter(Mandatory = $false)]
  [switch]$SkipLibVncBuild,

  [Parameter(Mandatory = $false)]
  [switch]$SkipNpmInstall,

  [Parameter(Mandatory = $false)]
  [switch]$SkipMsRdpSidecarBuild,

  [Parameter(Mandatory = $false)]
  [switch]$PersistUserEnvironment
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path (Join-Path $scriptDir "..")

function Write-Step {
  param([string]$Message)
  Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Write-Ok {
  param([string]$Message)
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Write-Skip {
  param([string]$Message)
  Write-Host "[SKIP] $Message" -ForegroundColor DarkGray
}

function Write-Action {
  param([string]$Message)
  Write-Host "[DO] $Message" -ForegroundColor Yellow
}

function Test-Command {
  param([string]$Name)
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Invoke-External {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$Description
  )

  Write-Action $Description
  Write-Host "$FilePath $($Arguments -join ' ')" -ForegroundColor DarkGray
  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed: $FilePath $($Arguments -join ' ')"
  }
}

function Update-SessionPath {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = @($machinePath, $userPath) -join ";"
}

function Test-IsAdmin {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Install-WithPackageManager {
  param(
    [string]$Name,
    [string]$WingetId,
    [string[]]$ChocoPackage,
    [string[]]$WingetExtraArgs = @(),
    [string[]]$ChocoExtraArgs = @()
  )

  if ($SkipPackageInstall) {
    Write-Skip "$Name is missing, but package installation is disabled."
    return
  }

  if (Test-Command winget) {
    $args = @(
      "install",
      "--id", $WingetId,
      "--exact",
      "--accept-package-agreements",
      "--accept-source-agreements"
    ) + $WingetExtraArgs
    Invoke-External -FilePath "winget" -Arguments $args -Description "Installing $Name via winget"
    Update-SessionPath
    return
  }

  if (Test-Command choco) {
    $args = @("install") + $ChocoPackage + @("-y") + $ChocoExtraArgs
    Invoke-External -FilePath "choco" -Arguments $args -Description "Installing $Name via Chocolatey"
    Update-SessionPath
    return
  }

  throw "$Name is missing. Install winget or Chocolatey first, or install $Name manually and re-run this script."
}

function Get-NodeMajor {
  if (-not (Test-Command node)) {
    return $null
  }

  $versionText = & node --version
  if ($versionText -match '^v(?<major>\d+)\.') {
    return [int]$Matches.major
  }

  return $null
}

function Test-DotNet8Sdk {
  if (-not (Test-Command dotnet)) {
    return $false
  }

  $sdks = & dotnet --list-sdks
  return [bool]($sdks | Where-Object { $_ -match '^8\.' })
}

function Test-RustMsvcTarget {
  if (-not (Test-Command rustup)) {
    return $false
  }

  $targets = & rustup target list --installed
  return [bool]($targets | Where-Object { $_ -eq "x86_64-pc-windows-msvc" })
}

function Test-VisualStudioCppTools {
  $vswhereCandidates = @(
    "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe",
    "$env:ProgramFiles\Microsoft Visual Studio\Installer\vswhere.exe"
  )

  foreach ($candidate in $vswhereCandidates) {
    if (Test-Path $candidate) {
      $installationPath = & $candidate -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
      if (-not [string]::IsNullOrWhiteSpace($installationPath)) {
        return $true
      }
    }
  }

  $cl = Get-ChildItem "$env:ProgramFiles\Microsoft Visual Studio" -Recurse -Filter cl.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match '\\VC\\Tools\\MSVC\\' } |
    Select-Object -First 1

  return [bool]$cl
}

function Test-WebView2Runtime {
  $registryPaths = @(
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1C3FE3F-10F6-4A5B-9F56-1F42F5979293}",
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F1C3FE3F-10F6-4A5B-9F56-1F42F5979293}"
  )

  foreach ($path in $registryPaths) {
    if (Test-Path $path) {
      return $true
    }
  }

  return $false
}

function Find-OpenSslRoot {
  $candidates = @(
    $env:OPENSSL_ROOT_DIR,
    "C:\Program Files\OpenSSL-Win64",
    "C:\Program Files\OpenSSL",
    "C:\ProgramData\chocolatey\lib\openssl\tools",
    "C:\Program Files\OpenSSL-Win32"
  ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

  foreach ($candidate in $candidates) {
    if ((Test-Path (Join-Path $candidate "include\openssl\ssl.h")) -and (Test-Path (Join-Path $candidate "lib"))) {
      return $candidate
    }
  }

  return $null
}

function Test-LibVncInstall {
  param([string]$InstallDir)

  $header = Join-Path $InstallDir "include\rfb\rfbclient.h"
  $library = Join-Path $InstallDir "lib\vncclient.lib"
  return (Test-Path $header) -and (Test-Path $library)
}

Write-Step "Checking Windows development dependencies"
if (-not (Test-IsAdmin)) {
  Write-Host "This script can detect installed tools without admin rights, but installing Visual Studio Build Tools may require an elevated PowerShell." -ForegroundColor Yellow
}

if (Test-Command git) {
  Write-Ok "Git is installed."
} else {
  Install-WithPackageManager -Name "Git" -WingetId "Git.Git" -ChocoPackage "git"
}

$nodeMajor = Get-NodeMajor
if ($nodeMajor -and $nodeMajor -ge 20) {
  Write-Ok "Node.js $nodeMajor is installed."
} else {
  Install-WithPackageManager -Name "Node.js 20+" -WingetId "OpenJS.NodeJS.LTS" -ChocoPackage "nodejs-lts"
}

if (Test-Command npm) {
  Write-Ok "npm is installed."
} else {
  throw "npm was not found after Node.js check. Open a new PowerShell and re-run this script."
}

if (Test-Command rustup) {
  Write-Ok "rustup is installed."
} else {
  Install-WithPackageManager -Name "Rustup" -WingetId "Rustlang.Rustup" -ChocoPackage "rustup.install"
}

if (Test-Command rustup) {
  Invoke-External -FilePath "rustup" -Arguments @("toolchain", "install", "stable-msvc") -Description "Ensuring Rust stable-msvc toolchain"
  Invoke-External -FilePath "rustup" -Arguments @("default", "stable-msvc") -Description "Setting Rust default toolchain to stable-msvc"
  if (Test-RustMsvcTarget) {
    Write-Ok "Rust target x86_64-pc-windows-msvc is installed."
  } else {
    Invoke-External -FilePath "rustup" -Arguments @("target", "add", "x86_64-pc-windows-msvc") -Description "Installing Rust MSVC target"
  }
} else {
  throw "rustup was not found after installation. Open a new PowerShell and re-run this script."
}

if (Test-DotNet8Sdk) {
  Write-Ok ".NET SDK 8.x is installed."
} else {
  Install-WithPackageManager -Name ".NET SDK 8" -WingetId "Microsoft.DotNet.SDK.8" -ChocoPackage "dotnet-8.0-sdk"
}

if (Test-Command cmake) {
  Write-Ok "CMake is installed."
} else {
  Install-WithPackageManager -Name "CMake" -WingetId "Kitware.CMake" -ChocoPackage "cmake" -ChocoExtraArgs @("--installargs", "ADD_CMAKE_TO_PATH=System")
}

if (Test-WebView2Runtime) {
  Write-Ok "WebView2 Runtime is installed."
} else {
  Install-WithPackageManager -Name "WebView2 Runtime" -WingetId "Microsoft.EdgeWebView2Runtime" -ChocoPackage "microsoft-edge-webview2-runtime"
}

if (Test-VisualStudioCppTools) {
  Write-Ok "Visual Studio C++ Build Tools are installed."
} else {
  $vsWingetArgs = @(
    "--silent",
    "--override",
    "--wait --quiet --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.VC.CMake.Project --add Microsoft.VisualStudio.Component.Windows11SDK.22621"
  )
  Install-WithPackageManager -Name "Visual Studio 2022 C++ Build Tools" -WingetId "Microsoft.VisualStudio.2022.BuildTools" -ChocoPackage @("visualstudio2022buildtools", "visualstudio2022-workload-vctools") -WingetExtraArgs $vsWingetArgs
}

$opensslRoot = Find-OpenSslRoot
if ($opensslRoot) {
  Write-Ok "OpenSSL development files found at $opensslRoot."
  $env:OPENSSL_ROOT_DIR = $opensslRoot
} else {
  Install-WithPackageManager -Name "OpenSSL" -WingetId "ShiningLight.OpenSSL.Dev" -ChocoPackage "openssl"
  $opensslRoot = Find-OpenSslRoot
  if ($opensslRoot) {
    $env:OPENSSL_ROOT_DIR = $opensslRoot
    Write-Ok "OpenSSL development files found at $opensslRoot."
  } else {
    Write-Host "OpenSSL was installed or requested, but OPENSSL_ROOT_DIR could not be auto-detected. If LibVNCServer configure fails, set `$env:OPENSSL_ROOT_DIR manually and re-run." -ForegroundColor Yellow
  }
}

if ($PersistUserEnvironment -and $env:OPENSSL_ROOT_DIR) {
  [Environment]::SetEnvironmentVariable("OPENSSL_ROOT_DIR", $env:OPENSSL_ROOT_DIR, "User")
  Write-Ok "Persisted OPENSSL_ROOT_DIR=$env:OPENSSL_ROOT_DIR"
}

Write-Step "Installing project dependencies"
Push-Location $repoRoot
try {
  if ($SkipNpmInstall) {
    Write-Skip "npm install was skipped."
  } else {
    Invoke-External -FilePath "npm" -Arguments @("install") -Description "Installing frontend dependencies"
  }

  if ($SkipMsRdpSidecarBuild) {
    Write-Skip "msrdpax sidecar build was skipped."
  } else {
    Invoke-External -FilePath "npm" -Arguments @("run", "build:msrdpax-sidecar:release") -Description "Building msrdpax sidecar"
  }
} finally {
  Pop-Location
}

Write-Step "Preparing LibVNCClient"
if ($SkipLibVncBuild) {
  Write-Skip "LibVNCServer build was skipped."
} elseif (Test-LibVncInstall -InstallDir $LibVncInstallDir) {
  Write-Ok "LibVNCClient is already installed at $LibVncInstallDir."
} else {
  $libVncScript = Join-Path $scriptDir "setup-libvncserver-msvc.ps1"
  $libVncArgs = @(
    "-GitRef", $LibVncRef,
    "-Depth", "1",
    "-SourceDir", $LibVncSourceDir,
    "-InstallDir", $LibVncInstallDir,
    "-Configuration", "Release",
    "-EnableSystemOpenSSL",
    "-SkipGitPull"
  )

  if ($PersistUserEnvironment) {
    $libVncArgs += "-PersistUserEnvironment"
  }

  Invoke-External -FilePath "powershell" -Arguments (@("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", $libVncScript) + $libVncArgs) -Description "Building LibVNCServer/LibVNCClient for MSVC"
}

$env:LIBVNCSERVER_ROOT = $LibVncInstallDir
if ($PersistUserEnvironment) {
  [Environment]::SetEnvironmentVariable("LIBVNCSERVER_ROOT", $LibVncInstallDir, "User")
  Write-Ok "Persisted LIBVNCSERVER_ROOT=$LibVncInstallDir"
}

Write-Step "Verifying key commands"
$checks = @("git", "node", "npm", "rustup", "cargo", "dotnet", "cmake")
foreach ($check in $checks) {
  if (Test-Command $check) {
    Write-Ok "$check is available."
  } else {
    throw "$check is still not available in PATH. Open a new PowerShell and re-run this script."
  }
}

if (-not (Test-LibVncInstall -InstallDir $LibVncInstallDir)) {
  throw "LibVNCClient install was not found at $LibVncInstallDir."
}

Write-Step "Done"
Write-Host "Development environment is ready for this project." -ForegroundColor Green
Write-Host "Current session variables:" -ForegroundColor Green
Write-Host "  `$env:LIBVNCSERVER_ROOT = '$LibVncInstallDir'" -ForegroundColor Yellow
if ($env:OPENSSL_ROOT_DIR) {
  Write-Host "  `$env:OPENSSL_ROOT_DIR = '$env:OPENSSL_ROOT_DIR'" -ForegroundColor Yellow
}
Write-Host "Next commands:" -ForegroundColor Green
Write-Host "  npm run tauri:dev" -ForegroundColor Yellow
Write-Host "  npm run tauri:build" -ForegroundColor Yellow
