<#
  Launch.ps1 — starts the bundled server hidden (no console window) and opens
  the browser once it's actually ready. Run via BMG.CLIP-V3.vbs so even this
  PowerShell window never flashes on screen — double-click should feel like
  opening a normal desktop app, not a script.
#>
$ErrorActionPreference = "SilentlyContinue"
$Root = $PSScriptRoot
if (-not $Root) { $Root = Split-Path -Parent $MyInvocation.MyCommand.Definition }
if (-not $Root) { $Root = (Get-Location).Path }

$env:PATH = "$Root\ffmpeg;$Root\python;$env:PATH"
$env:HF_HOME = "$Root\models"
$env:HF_HUB_DISABLE_TELEMETRY = "1"

$py = Join-Path $Root ".venv\Scripts\python.exe"
if (-not (Test-Path $py)) { $py = Join-Path $Root "python\python.exe" }
if (-not (Test-Path $py)) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Python runtime not found in: $py", "BMG.CLIP-V3 Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}

# 1. Check if an instance of THIS installation is already running
$portFile = Join-Path $Root ".port"
$pidFile = Join-Path $Root ".pid"

if ((Test-Path $portFile) -and (Test-Path $pidFile)) {
  try {
    $savedPort = [int]((Get-Content $portFile -Raw).Trim())
    $savedPid = [int]((Get-Content $pidFile -Raw).Trim())
    $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.Path -ieq $py) {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$savedPort/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200 -and $r.Content -match '"status":\s*"ok"') {
        Start-Process "http://127.0.0.1:$savedPort"
        exit 0
      }
    }
  } catch {}
}

# 2. Select an available port (8000..8010)
$chosenPort = $null
for ($p = 8000; $p -le 8010; $p++) {
  $listener = $null
  try {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $p)
    $listener.Start()
    $listener.Stop()
    $chosenPort = $p
    break
  } catch {
    # Port is occupied, continue to next
  } finally {
    if ($listener) {
      try { $listener.Stop() } catch {}
    }
  }
}

if (-not $chosenPort) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("BMG.CLIP-V3 could not start because ports 8000 through 8010 are already in use. Close another BMG.CLIP-V3 instance or free one of those ports, then try again.", "BMG.CLIP-V3 Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}

try {
  Set-Content -Path $portFile -Value "$chosenPort" -Encoding ASCII -Force
} catch {}

$serverProc = Start-Process -FilePath $py `
  -ArgumentList "-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "$chosenPort" `
  -WorkingDirectory $Root -WindowStyle Hidden -PassThru

if (-not $serverProc) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("BMG.CLIP-V3 could not start its bundled Python runtime. Check whether security software blocked it, then try again.", "BMG.CLIP-V3 Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}

try {
  Set-Content -Path $pidFile -Value "$($serverProc.Id)" -Encoding ASCII -Force
} catch {}

# 3. Poll /health until server is ready
$ready = $false
for ($i = 0; $i -lt 600; $i++) {
  if ($serverProc -and $serverProc.HasExited) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show("BMG.CLIP-V3 server failed to start or crashed unexpectedly.", "BMG.CLIP-V3 Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
    exit 1
  }
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$chosenPort/health" -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200 -and $r.Content -match '"status":\s*"ok"' -and $serverProc -and -not $serverProc.HasExited) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}

if ($ready) {
  Start-Process "http://127.0.0.1:$chosenPort"
} else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("BMG.CLIP-V3 did not become ready. Please restart it and check that security software is not blocking its bundled Python runtime.", "BMG.CLIP-V3 Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
}
