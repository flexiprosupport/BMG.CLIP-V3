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

$machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
$env:PATH = "$Root\ffmpeg;$Root\python;$env:ProgramFiles\nodejs;$machinePath;$userPath;$env:PATH"
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
$expectedFingerprint = (& $py -c "import hashlib,pathlib,sys; r=pathlib.Path(sys.argv[1]); e=[p.name+':'+hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(r.glob('*.py'),key=lambda p:p.name)]; print(hashlib.sha256('|'.join(e).encode('utf-8')).hexdigest())" (Join-Path $Root "app") | Out-String).Trim()
if ($LASTEXITCODE -ne 0 -or $expectedFingerprint -notmatch '^[0-9a-f]{64}$') {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("Cannot verify the installed app files. Please run the latest BMG.CLIP-V3 Setup again.", "BMG.CLIP-V3 Error")
  exit 1
}

if ((Test-Path $portFile) -and (Test-Path $pidFile)) {
  try {
    $savedPort = [int]((Get-Content $portFile -Raw).Trim())
    $savedPid = [int]((Get-Content $pidFile -Raw).Trim())
    $proc = Get-Process -Id $savedPid -ErrorAction SilentlyContinue
    if ($proc -and $proc.Path -ieq $py) {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$savedPort/health" -UseBasicParsing -TimeoutSec 2
      if ($r.StatusCode -eq 200 -and $r.Content -match '"status":\s*"ok"') {
        $health = $r.Content | ConvertFrom-Json
        if ($health.api_contract -eq 3 -and $health.source_fingerprint -eq $expectedFingerprint) {
          Start-Process "http://127.0.0.1:$savedPort"
          exit 0
        }
        Add-Type -AssemblyName System.Windows.Forms
        $answer = [System.Windows.Forms.MessageBox]::Show("An older BMG.CLIP-V3 backend is still running. Restart it to finish the update? Current processing will be interrupted; completed clips are kept. Choose No to leave it running.", "BMG.CLIP-V3 Update", [System.Windows.Forms.MessageBoxButtons]::YesNo, [System.Windows.Forms.MessageBoxIcon]::Warning)
        if ($answer -ne [System.Windows.Forms.DialogResult]::Yes) { exit 0 }
        # Only terminate the process already verified to use THIS installation's Python.
        & "$env:WINDIR\System32\taskkill.exe" /PID $savedPid /T /F | Out-Null
        Start-Sleep -Seconds 1
        if (Get-Process -Id $savedPid -ErrorAction SilentlyContinue) {
          [System.Windows.Forms.MessageBox]::Show("The old backend could not be stopped. Close it using Stop BMG.CLIP-V3, then reopen the app.", "BMG.CLIP-V3 Update")
          exit 1
        }
        Remove-Item $pidFile, $portFile -Force -ErrorAction SilentlyContinue
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
    $health = $r.Content | ConvertFrom-Json
    if ($r.StatusCode -eq 200 -and $health.status -eq "ok" -and $health.api_contract -eq 3 -and $health.source_fingerprint -eq $expectedFingerprint -and $serverProc -and -not $serverProc.HasExited) { $ready = $true; break }
  } catch {}
  Start-Sleep -Seconds 1
}

if ($ready) {
  Start-Process "http://127.0.0.1:$chosenPort"
} else {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show("BMG.CLIP-V3 did not become ready. Please restart it and check that security software is not blocking its bundled Python runtime.", "BMG.CLIP-V3 Error", [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Error)
}
