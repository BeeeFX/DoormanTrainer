# Doorman Trainer launcher (Windows PowerShell 5.1). "Doorman Trainer.cmd" runs it.
#  1. Checks GitHub for a newer release; if there is one, installs it silently
#     and carries on with the new version.
#  2. Starts the trainer (modlock.exe play mod), which launches Deadlock into it.
#  3. Waits for Deadlock to open, then for it to close, and stops the trainer
#     with it, so this window closes when you quit the game.
# Keep this file ASCII: Windows PowerShell reads a file without a BOM as ANSI.

param(
  [switch]$NoUpdate,
  # For testing the launcher without the game: what to run and what to follow.
  [string]$Trainer = 'modlock.exe',
  [string[]]$TrainerArgs = @('play', 'mod'),
  [string]$Game = 'deadlock'
)

$ErrorActionPreference = 'Stop'
$Host.UI.RawUI.WindowTitle = 'Doorman Trainer'
Set-Location -LiteralPath $PSScriptRoot

$Repo = 'BeeeFX/DoormanTrainer'
$SetupName = 'DoormanTrainer-win-Setup.exe'
$GameProcess = $Game
$GameWaitSeconds = 300 # give up following the game if it hasn't opened by then

function Say([string]$text, [string]$color = 'Gray') { Write-Host "  $text" -ForegroundColor $color }

function Get-InstalledVersion {
  try { return [version](Get-Content -LiteralPath 'mod\mod.json' -Raw | ConvertFrom-Json).version } catch { return [version]'0.0.0' }
}

function Stop-Tree([int]$id) {
  # modlock.exe runs the server in a child process: stop the whole tree.
  if ($id -le 0) { return } # never a tree we didn't start
  $ErrorActionPreference = 'Continue'
  $out = & taskkill.exe /PID $id /T /F 2>&1
  if ($LASTEXITCODE -ne 0) { Say "Couldn't stop the trainer (process $id): $out" 'Yellow' }
}

$version = Get-InstalledVersion
Write-Host ''
Write-Host "  Doorman Trainer $version" -ForegroundColor Yellow
Write-Host '  ---------------------'

# ---- 1. update ----
if (-not $NoUpdate) {
  try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 6 -Headers @{ 'User-Agent' = 'DoormanTrainer-launcher' }
    $latest = [version]($release.tag_name.TrimStart('v'))
    if ($latest -gt $version) {
      $asset = $release.assets | Where-Object { $_.name -eq $SetupName } | Select-Object -First 1
      if ($asset) {
        Say "Updating to $latest..." 'Cyan'
        $setup = Join-Path $env:TEMP "DoormanTrainer-Setup-$latest.exe"
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $setup -UseBasicParsing -TimeoutSec 300
        $p = Start-Process -FilePath $setup -ArgumentList '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', '/CURRENTUSER' -Wait -PassThru
        Remove-Item -LiteralPath $setup -ErrorAction SilentlyContinue
        if ($p.ExitCode -eq 0) {
          Say "Updated to $latest." 'Green'
          # The installer replaced this script: run the new one.
          & (Join-Path $PSScriptRoot 'launcher.ps1') -NoUpdate
          exit $LASTEXITCODE
        }
        Say "The update didn't install (code $($p.ExitCode)); starting $version." 'Yellow'
      }
    }
  } catch {
    Say "Couldn't check for updates; starting $version." 'DarkGray'
  }
}

# ---- 2. start ----
Say 'Starting Deadlock in the trainer. Steam needs to be running.'
Say 'This window closes by itself when you quit Deadlock.'
Write-Host ''
$exe = if ([IO.Path]::IsPathRooted($Trainer) -or -not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $Trainer))) { $Trainer } else { Join-Path $PSScriptRoot $Trainer }
$server = Start-Process -FilePath $exe -ArgumentList $TrainerArgs -NoNewWindow -PassThru
$null = $server.Handle # keeps the exit code readable later

# ---- 3. follow the game ----
$started = Get-Date
$gameSeen = $false
$gameClosed = $false
while (-not $server.HasExited) {
  $game = Get-Process -Name $GameProcess -ErrorAction SilentlyContinue
  if ($game) {
    $gameSeen = $true
  } elseif ($gameSeen) {
    $gameClosed = $true
    break
  } elseif (((Get-Date) - $started).TotalSeconds -gt $GameWaitSeconds) {
    # The game never showed up: stop following it, keep the trainer running.
    $server.WaitForExit()
    break
  }
  Start-Sleep -Seconds 2
}

if ($gameClosed) {
  Write-Host ''
  Say 'Deadlock closed: stopping the trainer.' 'Cyan'
  Stop-Tree $server.Id
  Start-Sleep -Milliseconds 800
  exit 0
}

# The trainer stopped on its own.
$code = 0
try { $code = $server.ExitCode } catch {}
if ($code -ne 0 -and $code -ne $null) {
  Write-Host ''
  Say 'Something went wrong. The lines above say what.' 'Red'
  Say "Help: https://github.com/$Repo/issues"
  Write-Host ''
  Read-Host '  Press Enter to close'
}
exit $code
