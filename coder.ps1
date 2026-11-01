# Coder launcher for Windows (PowerShell).  Usage: .\coder.ps1 [command]   (or coder.cmd)
# Uses Bun 1.4.4. If it isn't installed, downloads the official release and checks its
# SHA-256 against the value below before running it.
$ErrorActionPreference = 'Stop'
$BunVersion = '1.4.4'
$Root = $PSScriptRoot
$LocalBun = Join-Path $Root '.coder\bun\bun.exe'

function Test-Bun([string]$Path) {
  if (-not $Path -or -not (Test-Path $Path)) { return $false }
  try { return ((& $Path --version) -eq $BunVersion) } catch { return $false }
}

function Install-Bun {
  $arch = $env:PROCESSOR_ARCHITECTURE
  if ($arch -eq 'ARM64') {
    $target = 'windows-aarch64'; $sum = '2d57a0eec0cb44d95c918c3f9734f60455a1306ae5085d76fc68f44e3ee30d09'
  } else {
    # The baseline build runs on every x64 CPU.
    $target = 'windows-x64-baseline'; $sum = '0f20ce6674d4f2dbcc8c5d59fdf99f7ba45f8c3b367e0f5781cbfa30a1c78d99'
  }
  $url = "https://github.com/oven-sh/bun/releases/download/bun-v$BunVersion/bun-$target.zip"
  $tmp = Join-Path $Root '.coder\bun.tmp'
  if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $tmp | Out-Null
  $zip = Join-Path $tmp 'bun.zip'
  Write-Host "Downloading Bun $BunVersion ($target)..."
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $zip
  $actual = (Get-FileHash -Algorithm SHA256 -Path $zip).Hash.ToLower()
  if ($actual -ne $sum) { Remove-Item $tmp -Recurse -Force; throw "Checksum mismatch for $url, refusing to use it." }
  Expand-Archive -Path $zip -DestinationPath $tmp -Force
  New-Item -ItemType Directory -Force -Path (Split-Path $LocalBun) | Out-Null
  Move-Item -Force (Join-Path $tmp "bun-$target\bun.exe") $LocalBun
  Remove-Item $tmp -Recurse -Force
}

$Bun = $null
$onPath = (Get-Command bun -ErrorAction SilentlyContinue).Source
foreach ($candidate in @($LocalBun, $onPath, (Join-Path $env:USERPROFILE '.bun\bin\bun.exe'))) {
  if (Test-Bun $candidate) { $Bun = $candidate; break }
}
if (-not $Bun) { Install-Bun; $Bun = $LocalBun }

& $Bun (Join-Path $Root 'src\cli.ts') @args
exit $LASTEXITCODE
