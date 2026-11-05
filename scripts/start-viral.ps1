# Starts the Viral dashboard with one double-click. Checks the toolchain, installs
# dependencies only when they are stale, builds, launches the dashboard in the
# foreground, and opens the browser once the server answers. Ctrl+C stops it.
$ErrorActionPreference = "Stop"

# Work from the repository root (this script lives in <repo>/scripts).
$repoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $repoRoot

function Require-Command {
    param([string]$Name, [string]$Hint)
    $found = Get-Command $Name -ErrorAction SilentlyContinue
    if (-not $found) {
        Write-Host "Viral launcher: '$Name' is not on your PATH." -ForegroundColor Red
        Write-Host $Hint -ForegroundColor Yellow
        exit 1
    }
}

Require-Command -Name "node" -Hint "Install Node.js from https://nodejs.org/ (LTS), then re-run this launcher."
Require-Command -Name "pnpm" -Hint "Install pnpm after Node.js with: npm install -g pnpm"

# Install dependencies only when node_modules is missing, or the lockfile is newer than it.
$needInstall = $false
if (-not (Test-Path "node_modules")) {
    $needInstall = $true
} elseif (Test-Path "pnpm-lock.yaml") {
    $lock = (Get-Item "pnpm-lock.yaml").LastWriteTime
    $modules = (Get-Item "node_modules").LastWriteTime
    if ($lock -gt $modules) { $needInstall = $true }
}
if ($needInstall) {
    Write-Host "Viral launcher: installing dependencies (first run or lockfile changed)..." -ForegroundColor Cyan
    & pnpm install
    if ($LASTEXITCODE -ne 0) { throw "pnpm install failed (exit $LASTEXITCODE)." }
} else {
    Write-Host "Viral launcher: dependencies are up to date." -ForegroundColor DarkGray
}

Write-Host "Viral launcher: building..." -ForegroundColor Cyan
& pnpm run build
if ($LASTEXITCODE -ne 0) { throw "pnpm run build failed (exit $LASTEXITCODE)." }

# Read the dashboard port from the config, defaulting to 4174.
$port = 4174
if (Test-Path "viral-dev.config.json") {
    try {
        $config = Get-Content "viral-dev.config.json" -Raw | ConvertFrom-Json
        if ($config.dashboard -and $config.dashboard.port) { $port = [int]$config.dashboard.port }
    } catch {
        Write-Host "Viral launcher: could not read dashboard.port; using $port." -ForegroundColor Yellow
    }
}
$url = "http://127.0.0.1:$port"

Write-Host "Viral launcher: starting the dashboard on $url (press Ctrl+C to stop)..." -ForegroundColor Green
# Run the server in this console so its output shows and Ctrl+C stops it. pnpm is a .cmd
# shim on Windows, which Start-Process cannot launch directly, so go through cmd.exe.
$server = Start-Process -FilePath "cmd.exe" -ArgumentList @("/c", "pnpm", "run", "viral-dev", "dashboard") -NoNewWindow -PassThru

try {
    # Poll for up to 30 seconds, then open the browser once the port answers.
    $opened = $false
    for ($i = 0; $i -lt 30; $i++) {
        if ($server.HasExited) { throw "The dashboard process exited before it was ready (exit $($server.ExitCode))." }
        $client = New-Object System.Net.Sockets.TcpClient
        try {
            $client.Connect("127.0.0.1", $port)
            if ($client.Connected) {
                $client.Close()
                Write-Host "Viral launcher: dashboard is up; opening $url" -ForegroundColor Green
                Start-Process $url
                $opened = $true
                break
            }
        } catch {
            # Not listening yet; wait and retry.
        } finally {
            $client.Dispose()
        }
        Start-Sleep -Seconds 1
    }
    if (-not $opened) {
        Write-Host "Viral launcher: server did not answer within 30s; open $url manually once it is ready." -ForegroundColor Yellow
    }
    # Keep the launcher in the foreground until the server stops (Ctrl+C ends both).
    Wait-Process -Id $server.Id
} finally {
    if (-not $server.HasExited) {
        try { Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue } catch {}
    }
}
