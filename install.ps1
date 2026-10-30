<#
.SYNOPSIS
  Installs proofmap globally for the current user.

.DESCRIPTION
  Needs only elan (every Lean user has it) and git. Downloads the proofmap release into
  ~\.proofmap\repo, keeps its Lean source in ~\.proofmap\src\<version> (engines for other
  toolchains are built from it on first use), builds the launcher with proofmap's own toolchain,
  and puts ~\.proofmap\bin on the user PATH.

    irm https://raw.githubusercontent.com/n0zer0d4y/proofmap/main/install.ps1 | iex

  Options can also be given as environment variables, which is how they reach a piped install:
  PROOFMAP_VERSION, PROOFMAP_SOURCE, PROOFMAP_HOME, PROOFMAP_NO_MODIFY_PATH=1.

.PARAMETER Version
  Release tag to install (default: the latest vX.Y.Z tag).
.PARAMETER Source
  Install from this local checkout instead of downloading (used by self-update and tests).
.PARAMETER NoModifyPath
  Do not add ~\.proofmap\bin to the user PATH.
#>
param(
  [string]$Version = $env:PROOFMAP_VERSION,
  [string]$Source = $env:PROOFMAP_SOURCE,
  [switch]$NoModifyPath = ($env:PROOFMAP_NO_MODIFY_PATH -eq '1')
)

$ErrorActionPreference = 'Stop'
$Repo = 'https://github.com/n0zer0d4y/proofmap'
$ProofmapHome = if ($env:PROOFMAP_HOME) { $env:PROOFMAP_HOME } else { Join-Path $env:USERPROFILE '.proofmap' }

function Say([string]$m) { Write-Host "proofmap: $m" }
function Fail([string]$m) { Write-Host "proofmap: $m" -ForegroundColor Red; exit 1 }
function Need([string]$cmd, [string]$why) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "$cmd is required ($why) but was not found" }
}

Need 'elan' 'it installs the Lean toolchains proofmap is built with; see https://github.com/leanprover/elan'
Need 'lake' 'it comes with elan'

# 1. The release source.
if ($Source) {
  $Checkout = (Resolve-Path $Source).Path
  Say "installing from $Checkout"
} else {
  Need 'git' 'it downloads the release'
  $Checkout = Join-Path $ProofmapHome 'repo'
  if (-not $Version) {
    $tags = git ls-remote --tags --refs $Repo 'v*' | ForEach-Object { ($_ -split 'refs/tags/')[1] } | Where-Object { $_ -match '^v\d+\.\d+\.\d+$' }
    $Version = $tags | Sort-Object { [version]$_.TrimStart('v') } -Descending | Select-Object -First 1
    if (-not $Version) { Fail "no release found at $Repo" }
  }
  if (Test-Path (Join-Path $Checkout '.git')) {
    git -C $Checkout fetch --depth 1 origin tag $Version --force | Out-Null
    git -C $Checkout checkout --force $Version 2>$null | Out-Null
  } else {
    if (Test-Path $Checkout) { Remove-Item -Recurse -Force $Checkout }
    git clone --quiet --depth 1 --branch $Version $Repo $Checkout
  }
  if ($LASTEXITCODE -ne 0) { Fail "could not download proofmap $Version" }
  Say "downloaded proofmap $Version"
}
$Lean = Join-Path $Checkout 'lean'
if (-not (Test-Path (Join-Path $Lean 'lakefile.lean'))) { Fail "$Checkout is not a proofmap checkout (lean\lakefile.lean missing)" }
$Ver = ([regex]::Match((Get-Content -Raw (Join-Path $Lean 'Proofmap\Version.lean')), 'def version : String := "([^"]+)"')).Groups[1].Value
if (-not $Ver) { Fail 'could not read the proofmap version' }

# 2. The source engines are built from (without build output).
$Src = Join-Path $ProofmapHome "src\$Ver"
if (Test-Path $Src) { Remove-Item -Recurse -Force $Src }
New-Item -ItemType Directory -Force $Src | Out-Null
foreach ($item in 'lakefile.lean', 'lean-toolchain', 'lake-manifest.json', 'Main.lean', 'Proofmap.lean', 'Proofmap', 'compat', 'assets', 'test') {
  $from = Join-Path $Lean $item
  if (Test-Path $from) { Copy-Item -Recurse -Force $from (Join-Path $Src $item) }
}
Get-ChildItem -Path $Src -Recurse -Directory -Filter '.lake' | Remove-Item -Recurse -Force

# 3. The launcher, built with proofmap's own toolchain (elan installs it if needed).
Say "building the launcher (proofmap $Ver); the first time this downloads a Lean toolchain"
$Build = Join-Path $ProofmapHome "build\$Ver"
if (Test-Path $Build) { Remove-Item -Recurse -Force $Build }
Copy-Item -Recurse $Src $Build
Push-Location $Build
try {
  lake build proofmap
  if ($LASTEXITCODE -ne 0) { Fail 'building the launcher failed (see above)' }
  $Prefix = (lean --print-prefix).Trim()
} finally { Pop-Location }
$LauncherDir = Join-Path $ProofmapHome 'launcher'
New-Item -ItemType Directory -Force $LauncherDir | Out-Null
$Exe = Join-Path $LauncherDir 'proofmap.exe'
# A running launcher (self-update) cannot be overwritten, but it can be renamed.
if (Test-Path $Exe) { Move-Item -Force $Exe "$Exe.old" }
Copy-Item (Join-Path $Build '.lake\build\bin\proofmap.exe') $Exe
Remove-Item -Recurse -Force $Build

# 4. Shims: proofmap.cmd for cmd and PowerShell, proofmap (sh) for Git Bash. They put the
# launcher's Lean runtime first on PATH (Windows finds DLLs there), save the original PATH,
# which the launcher restores for every program it starts, and mark the process as the launcher.
$Bin = Join-Path $ProofmapHome 'bin'
New-Item -ItemType Directory -Force $Bin | Out-Null
$LeanBin = Join-Path $Prefix 'bin'
Set-Content -Encoding ascii (Join-Path $Bin 'proofmap.cmd') @"
@echo off
setlocal
set "PROOFMAP_SAVED_PATH=%PATH%"
set "PATH=$LeanBin;%PATH%"
set "PROOFMAP_LAUNCHER=1"
set "PROOFMAP_HOME=$ProofmapHome"
"$Exe" %*
"@
$sh = @"
#!/bin/sh
PROOFMAP_SAVED_PATH="`$(cygpath -w -p "`$PATH")" PATH="`$(cygpath -u '$LeanBin'):`$PATH" PROOFMAP_LAUNCHER=1 PROOFMAP_HOME='$ProofmapHome' exec "`$(cygpath -u '$Exe')" "`$@"
"@
[IO.File]::WriteAllText((Join-Path $Bin 'proofmap'), $sh.Replace("`r`n", "`n"))

# 5. PATH.
if (-not $NoModifyPath) {
  $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
  if (-not (($userPath -split ';') -contains $Bin)) {
    [Environment]::SetEnvironmentVariable('Path', ((@($userPath -split ';') | Where-Object { $_ }) + $Bin) -join ';', 'User')
    Say "added $Bin to your PATH; open a new terminal to use it"
  }
}
Say "installed proofmap $Ver. In a Lean project, run: proofmap build   (proofmap doctor checks the setup)"
