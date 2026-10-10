#requires -Version 5.1
<#
  Run Setup.cmd from the fully extracted project folder.
  This installs dependencies locally and creates desktop shortcuts.
  Missing Python/FFmpeg are installed through WinGet only after confirmation.
  Existing app folders, models, videos, and shortcuts are never deleted.
#>
param([switch]$InstallerMode, [switch]$BootstrapMode)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
Set-Location -LiteralPath $Root
$logStarted = $false

function Confirm-Action([string]$Message) {
    $answer = Read-Host "$Message [y/N]"
    return ($answer -match "^(?i:y|yes)$")
}

function Refresh-Path {
    $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $user = [Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = (@("$Root\ffmpeg", "$Root\python", "$env:ProgramFiles\nodejs", $machine, $user, $env:Path) -join ";")
}

function Find-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $command) { return $null }
    $version = & $command.Source -p "Number(process.versions.node.split('.')[0])" 2>$null
    if ($LASTEXITCODE -eq 0 -and [int]$version -ge 22) { return $command.Source }
    return $null
}

function Test-Python([string]$Path) {
    if (-not $Path -or -not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    # Do not activate the Microsoft Store placeholder executable.
    if ($Path -match "\\Microsoft\\WindowsApps\\python[^\\]*\.exe$") { return $false }
    try {
        $result = & $Path -c "import sys,struct; print(int((3,11) <= sys.version_info[:2] < (3,14) and struct.calcsize('P') == 8))" 2>$null
        return ($LASTEXITCODE -eq 0 -and "$result".Trim() -eq "1")
    } catch { return $false }
}

function Find-Python {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($launcher) {
        foreach ($selector in @("-3.11", "-3.12", "-3.13")) {
            try {
                $path = & $launcher.Source $selector -c "import sys; print(sys.executable)" 2>$null
                if ($LASTEXITCODE -eq 0 -and (Test-Python "$path")) { return "$path".Trim() }
            } catch {}
        }
    }
    foreach ($version in @("311", "312", "313")) {
        $path = Join-Path $env:LOCALAPPDATA "Programs\Python\Python$version\python.exe"
        if (Test-Python $path) { return $path }
        $path = Join-Path $env:ProgramFiles "Python$version\python.exe"
        if (Test-Python $path) { return $path }
    }
    foreach ($name in @("python.exe", "python3.exe")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if ($command -and (Test-Python $command.Source)) { return $command.Source }
    }
    return $null
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed with exit code $LASTEXITCODE." }
}

function Install-Prerequisite([string]$Id, [string]$Name) {
    $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $winget) {
        throw "$Name is missing, and WinGet is unavailable. Install Microsoft's App Installer from the Microsoft Store, or install $Name manually, then run Setup.cmd again."
    }
    if (-not (Confirm-Action "Install $Name through WinGet and accept its package/source agreements?")) {
        throw "$Name is required. No installation was started."
    }
    Invoke-Checked $winget.Source @(
        "install", "--id", $Id, "--exact", "--source", "winget",
        "--accept-package-agreements", "--accept-source-agreements"
    )
    Refresh-Path
}

function Add-DesktopShortcut([string]$Name, [string]$Script) {
    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop) { throw "Windows did not provide a desktop folder." }
    $path = Join-Path $desktop "$Name.lnk"
    $number = 2
    while (Test-Path -LiteralPath $path) {
        $path = Join-Path $desktop "$Name ($number).lnk"
        $number++
    }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($path)
    $shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
    $shortcut.Arguments = '"' + (Join-Path $Root $Script) + '"'
    $shortcut.WorkingDirectory = $Root
    $shortcut.Description = $Name
    $icon = Join-Path $Root "BMG.CLIP-V3-yellow.ico"
    if (Test-Path -LiteralPath $icon) { $shortcut.IconLocation = "$icon,0" }
    $shortcut.Save()
    Write-Host "Created desktop shortcut: $path"
}

try {
    foreach ($file in @("requirements.txt", "Launch.ps1", "BMG.CLIP-V3.vbs", "Stop BMG.CLIP-V3.vbs", "web\dist\index.html")) {
        if (-not (Test-Path -LiteralPath (Join-Path $Root $file) -PathType Leaf)) {
            throw "Missing $file. Extract the entire ZIP first; do not run Setup.cmd inside the ZIP or copy only the setup files."
        }
    }
    $log = Join-Path $Root ("setup-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")
    Start-Transcript -Path $log | Out-Null
    $logStarted = $true
    Write-Host "App folder: $Root"
    Write-Host "Setup installs Python and Node caption packages and adds desktop shortcuts."
    Write-Host "It does not delete your videos, models, existing apps, or shortcuts."
    Write-Host "Internet access is required. First setup can take several minutes."
    if (-not $InstallerMode -and -not $BootstrapMode -and -not (Confirm-Action "Continue with setup?")) {
        Write-Host "Cancelled. No prerequisites or Python packages were installed."
        exit 0
    }
    Refresh-Path
    $venvPython = Join-Path $Root ".venv\Scripts\python.exe"
    if (Test-Path -LiteralPath $venvPython) {
        if (-not (Test-Python $venvPython)) {
            throw "This folder's .venv is not a supported 64-bit Python 3.11-3.13 environment. Use a fresh extracted folder. Setup will not delete an existing environment."
        }
    } else {
        $python = Find-Python
        if (-not $python) {
            Install-Prerequisite "Python.Python.3.11" "64-bit Python 3.11"
            $python = Find-Python
        }
        if (-not $python) { throw "Python was not detected after installation. Close this window, then run Setup.cmd again." }
        Invoke-Checked $python @("-m", "venv", (Join-Path $Root ".venv"))
    }
    if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) -or -not (Get-Command ffprobe.exe -ErrorAction SilentlyContinue)) {
        Install-Prerequisite "Gyan.FFmpeg" "FFmpeg (including ffprobe)"
    }
    foreach ($name in @("ffmpeg.exe", "ffprobe.exe")) {
        $command = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $command) { throw "$name was not detected. Close this window, then run Setup.cmd again." }
        Invoke-Checked $command.Source @("-version")
    }
    Invoke-Checked $venvPython @("-m", "pip", "install", "-r", (Join-Path $Root "requirements.txt"))
    Invoke-Checked $venvPython @("-c", "import fastapi, uvicorn, pydantic, yt_dlp, requests, faster_whisper, indic_transliteration")
    if (-not (Find-Node)) { Install-Prerequisite "OpenJS.NodeJS.LTS" "Node.js 22+ for caption rendering"; Refresh-Path }
    $node = Find-Node
    if (-not $node) { throw "Node.js 22+ was not detected. Close this window and run Setup.cmd again." }
    $npm = Join-Path (Split-Path $node -Parent) "npm.cmd"
    if (-not (Test-Path -LiteralPath $npm)) { throw "npm.cmd is missing. Repair the Node.js LTS installation." }
    Invoke-Checked $npm @("--prefix", (Join-Path $Root "caption_renderer"), "install", "--omit=dev", "--no-audit", "--no-fund")
    Push-Location (Join-Path $Root "caption_renderer")
    try { Invoke-Checked $node @("--input-type=module", "-e", "import {createCanvas} from '@napi-rs/canvas'; import {templates} from './engine.mjs'; if(templates.length !== 85 || createCanvas(8,8).data().length !== 256) throw Error('Caption renderer check failed');") }
    finally { Pop-Location }
    if (-not $InstallerMode) {
        Add-DesktopShortcut "BMG.CLIP-V3" "BMG.CLIP-V3.vbs"
        Add-DesktopShortcut "Stop BMG.CLIP-V3" "Stop BMG.CLIP-V3.vbs"
    }
    Write-Host ""
    Write-Host "Setup complete. Keep this app folder in place: the shortcuts use it."
    Write-Host "Whisper models and caption fonts download when first needed."
    if (-not $InstallerMode -and (Confirm-Action "Open BMG.CLIP-V3 now?")) {
        Start-Process -FilePath (Join-Path $env:WINDIR "System32\wscript.exe") -ArgumentList ('"' + (Join-Path $Root "BMG.CLIP-V3.vbs") + '"')
    }
} catch {
    Write-Host ""
    Write-Host ("SETUP ERROR: " + $_.Exception.Message) -ForegroundColor Red
    if ($logStarted) { Write-Host "Details are saved in: $log" }
    exit 1
} finally {
    if ($logStarted) { Stop-Transcript | Out-Null }
}
