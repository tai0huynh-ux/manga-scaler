param(
    [string]$Repository = (Split-Path -Parent $PSScriptRoot),
    [string]$TaskName = "AiMangaUpscalerAutoGitWatch"
)

$ErrorActionPreference = "Stop"
$Repository = (Resolve-Path -LiteralPath $Repository).Path
$WatchScript = Join-Path $PSScriptRoot "watch-auto-git-update.ps1"

$argument = @(
    "-NoProfile",
    "-ExecutionPolicy Bypass",
    "-WindowStyle Hidden",
    "-File `"$WatchScript`"",
    "-Repository `"$Repository`""
) -join " "

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argument
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName $TaskName `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Description "Watch AI Manga Upscaler files and run safe auto Git update after edits." `
    -Force | Out-Null

Start-ScheduledTask -TaskName $TaskName
Write-Output "Installed and started scheduled task '$TaskName' for $Repository."
