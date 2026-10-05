# keep-training-windows.ps1 - make TinyGPT keep training whenever you're logged in to Windows.
#
# Run these from PowerShell in this folder:
#   .\keep-training-windows.ps1 -Install     start now, and again every time you log in
#   .\keep-training-windows.ps1 -Pause       pause (keeps its place)
#   .\keep-training-windows.ps1 -Resume      carry on after -Pause
#   .\keep-training-windows.ps1 -Stop        save and stop until next login
#   .\keep-training-windows.ps1 -Status      is it running? show the last lines of the log
#   .\keep-training-windows.ps1 -Uninstall   stop it and remove it from startup
#
# If PowerShell says running scripts is disabled, start it like this instead:
#   powershell -ExecutionPolicy Bypass -File .\keep-training-windows.ps1 -Install
#
# Change what it runs with below: by default it trains the small model, only
# after 5 minutes with no mouse or keyboard use, and copies each better model
# into the chat app. For the bigger rtx4070 model, use "--preset rtx4070
# --only-when-idle 5" (the app runs TinyGPT in plain Python, so leave out
# --export-for-app: it would be far too slow there).

param([switch]$Install, [switch]$Uninstall, [switch]$Pause, [switch]$Resume, [switch]$Stop, [switch]$Status)

$TaskName = "TinyGPT keep training"
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path
$Out = Join-Path $Here "out"
$Options = "--preset small --only-when-idle 5 --export-for-app"

New-Item -ItemType Directory -Force -Path $Out | Out-Null

if ($Install) {
    $python = (Get-Command python -ErrorAction SilentlyContinue).Source
    if (-not $python) { Write-Host "Python isn't on your PATH. Install Python and PyTorch first (see the README)."; exit 1 }
    # pythonw is the same Python without a console window.
    $pythonw = Join-Path (Split-Path $python) "pythonw.exe"
    if (-not (Test-Path $pythonw)) { $pythonw = $python }
    & $python -c "import torch" 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "PyTorch isn't installed for $python. See the README for the install command."; exit 1 }

    $action = New-ScheduledTaskAction -Execute $pythonw -Argument "`"$Here\keep_training.py`" $Options" -WorkingDirectory $Here
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
    # No time limit, keep going on battery, and below-normal priority (7).
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries `
        -DontStopIfGoingOnBatteries -Priority 7 -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
    Remove-Item -ErrorAction SilentlyContinue (Join-Path $Out "PAUSE")
    Start-ScheduledTask -TaskName $TaskName
    Write-Host "Done. TinyGPT is training now and will start again each time you log in."
    Write-Host "Progress is written to $Out\keep-training.log"
}
elseif ($Pause) {
    New-Item -ItemType File -Force -Path (Join-Path $Out "PAUSE") | Out-Null
    Write-Host "Paused. Run with -Resume to carry on."
}
elseif ($Resume) {
    Remove-Item -ErrorAction SilentlyContinue (Join-Path $Out "PAUSE")
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task -and $task.State -ne "Running") { Start-ScheduledTask -TaskName $TaskName }
    Write-Host "Resumed."
}
elseif ($Stop -or $Uninstall) {
    # Ask it to save and stop by itself, then make sure it has.
    New-Item -ItemType File -Force -Path (Join-Path $Out "STOP") | Out-Null
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    for ($i = 0; $i -lt 30 -and $task -and (Get-ScheduledTask -TaskName $TaskName).State -eq "Running"; $i++) { Start-Sleep 2 }
    if ($task) { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue }
    if ($Uninstall) {
        Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
        Write-Host "Stopped and removed from startup. Your trained model in $Out is kept."
    } else {
        Write-Host "Stopped. It starts again next time you log in, or run with -Install to start it now."
    }
}
elseif ($Status) {
    $task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    if ($task) { Write-Host "Task: $($task.State)" } else { Write-Host "Not installed." }
    if (Test-Path (Join-Path $Out "PAUSE")) { Write-Host "Paused (PAUSE file is there)." }
    $logFile = Join-Path $Out "keep-training.log"
    if (Test-Path $logFile) { Get-Content $logFile -Tail 8 }
}
else {
    Get-Content $MyInvocation.MyCommand.Path -TotalCount 12 | ForEach-Object { $_ -replace "^# ?", "" }
}
