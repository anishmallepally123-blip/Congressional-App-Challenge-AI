# Local AI Chat launcher for Windows.
#
# Started by "Start Local AI Chat - Windows.bat". It makes sure the two things the app
# needs are present, downloading them the first time, then starts the app:
#   1. Python, to run the app's web server. If Python 3.9+ is not installed, a private
#      copy is downloaded into the "runtime" folder next to the app (nothing is installed
#      system-wide and no admin password is needed).
#   2. Ollama, the free engine that runs the AI model. If it isn't installed, the official
#      installer is downloaded and run silently (it installs for this user only).
# The AI model itself is downloaded from the app's setup page with one click.

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"   # Invoke-WebRequest is very slow with its progress bar on
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppDir = Split-Path -Parent $PSScriptRoot
$Runtime = Join-Path $AppDir "runtime"
$Port = 8000
$OllamaUrl = "http://127.0.0.1:11434"

function Say($text) { Write-Host "  $text" }
function Step($text) { Write-Host ""; Write-Host "> $text" -ForegroundColor Cyan }

function Fail($text) {
    Write-Host ""
    Write-Host "  Something went wrong: $text" -ForegroundColor Red
    Write-Host "  If a download failed, check your internet connection and double-click the Start file again."
    exit 1
}

function Download($url, $dest) {
    # curl.exe ships with Windows 10 and 11 and shows a progress bar; fall back to PowerShell's own downloader.
    $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
    if ($curl) {
        & $curl.Source -L --fail --progress-bar -o $dest $url
        if ($LASTEXITCODE -eq 0) { return }
    }
    Invoke-WebRequest -Uri $url -OutFile $dest -UseBasicParsing
}

function Responds($url) {
    try { Invoke-RestMethod -Uri $url -TimeoutSec 2 | Out-Null; return $true } catch { return $false }
}

Write-Host ""
Write-Host "  Local AI Chat" -ForegroundColor Green
Write-Host "  A private AI assistant that runs on this computer."

# Already running? Just open the page.
if (Responds "http://127.0.0.1:$Port/api/status") {
    Say "The app is already running. Opening it in your browser."
    Start-Process "http://localhost:$Port"
    exit 0
}

# ---------- 1. Python ----------
Step "Checking for Python"

function Find-Python {
    $mine = Join-Path $Runtime "python\python.exe"
    if (Test-Path $mine) { return $mine }
    # "python" may be the Microsoft Store shortcut, which prints nothing, so check it really runs.
    foreach ($name in @("py", "python", "python3")) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if (-not $cmd) { continue }
        try {
            $ok = & $cmd.Source -c "import sys; print(sys.version_info >= (3, 9))" 2>$null
            if ("$ok".Trim() -eq "True") { return $cmd.Source }
        } catch { }
    }
    return $null
}

function Install-Python {
    New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
    $archive = Join-Path $Runtime "python.tar.gz"
    try {
        # A ready-to-run Python build (python-build-standalone, used by tools like uv).
        $release = Invoke-RestMethod -Uri "https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest" -UseBasicParsing
        $asset = $release.assets | Where-Object { $_.name -match '^cpython-3\.12\.\d+\+\d+-x86_64-pc-windows-msvc-install_only\.tar\.gz$' } | Select-Object -First 1
        if (-not $asset) { throw "no matching build" }
        Say "Downloading Python (about 30 MB)..."
        Download $asset.browser_download_url $archive
        tar -xzf $archive -C $Runtime
        if ($LASTEXITCODE -ne 0) { throw "could not unpack Python" }
        Remove-Item $archive -Force
    } catch {
        # Fallback: the official "embeddable" Python from python.org.
        Say "Trying the python.org download instead..."
        $zip = Join-Path $Runtime "python.zip"
        Download "https://www.python.org/ftp/python/3.12.10/python-3.12.10-embed-amd64.zip" $zip
        Expand-Archive -Path $zip -DestinationPath (Join-Path $Runtime "python") -Force
        Remove-Item $zip -Force
    }
}

$Python = Find-Python
if (-not $Python) {
    Say "Python isn't installed, so the app will use its own copy."
    Install-Python
    $Python = Find-Python
    if (-not $Python) { Fail "Python could not be downloaded." }
}

# The embeddable Python ignores the script's folder unless it's listed in its ._pth file.
$pth = Get-ChildItem -Path (Join-Path $Runtime "python") -Filter "python3*._pth" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pth) {
    $zipName = (Get-ChildItem -Path $pth.DirectoryName -Filter "python3*.zip" | Select-Object -First 1).Name
    Set-Content -Path $pth.FullName -Encoding ASCII -Value @($zipName, ".", (Join-Path $AppDir "chatbot"))
}
Say "Python is ready."

# ---------- 2. Ollama ----------
Step "Checking for the AI engine (Ollama)"

function Find-Ollama {
    # Prefer the plain engine (ollama.exe): it runs hidden, while "ollama app.exe" opens a window.
    foreach ($dir in @("$env:LOCALAPPDATA\Programs\Ollama", "$env:ProgramFiles\Ollama")) {
        foreach ($name in @("ollama.exe", "ollama app.exe")) {
            $p = Join-Path $dir $name
            if (Test-Path $p) { return $p }
        }
    }
    $cmd = Get-Command ollama -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    return $null
}

function Wait-Ollama($seconds) {
    for ($i = 0; $i -lt $seconds; $i++) {
        if (Responds "$OllamaUrl/api/version") { return $true }
        Start-Sleep -Seconds 1
    }
    return $false
}

function Start-Ollama($exe) {
    if ($exe -like "*ollama app.exe") {
        Start-Process -FilePath $exe
    } else {
        Start-Process -FilePath $exe -ArgumentList "serve" -WindowStyle Hidden
    }
    return (Wait-Ollama 60)
}

if (-not (Responds "$OllamaUrl/api/version")) {
    $Ollama = Find-Ollama
    if (-not $Ollama) {
        Say "Ollama isn't installed yet. Downloading it (about 1 GB, this happens only once)..."
        New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
        $setup = Join-Path $Runtime "OllamaSetup.exe"
        try { Download "https://ollama.com/download/OllamaSetup.exe" $setup } catch { Fail "Ollama could not be downloaded." }
        Say "Installing Ollama... (if an Ollama window pops up, you can ignore it)"
        # Wait for the installer itself only. Start-Process -Wait would also wait for the Ollama
        # app the installer opens at the end, which never exits, so the launcher would hang here.
        $installer = Start-Process -FilePath $setup -ArgumentList "/VERYSILENT", "/NORESTART", "/SUPPRESSMSGBOXES" -PassThru
        for ($i = 0; $i -lt 900 -and -not $installer.HasExited; $i++) {
            if ($i -gt 10 -and (Responds "$OllamaUrl/api/version")) { break }
            Start-Sleep -Seconds 1
        }
        Remove-Item $setup -Force -ErrorAction SilentlyContinue
        $Ollama = Find-Ollama
        if (-not $Ollama) { Fail "Ollama did not install." }
        # The installer usually starts Ollama by itself; give it a moment before starting another copy.
        Wait-Ollama 20 | Out-Null
    }
    if (-not (Responds "$OllamaUrl/api/version")) {
        Say "Starting Ollama..."
        if (-not (Start-Ollama $Ollama)) { Fail "Ollama did not start." }
    }
}
Say "Ollama is running."

# ---------- 3. The app ----------
Step "Starting Local AI Chat"
Say "Your browser will open http://localhost:$Port"
Say "The first time, click the button on that page to download an AI model."
Say "Keep this window open while you use the app. Close it to stop the app."
Write-Host ""

Set-Location (Join-Path $AppDir "chatbot")
& $Python server.py
exit $LASTEXITCODE
