param(
    [string]$Repository = (Split-Path -Parent $PSScriptRoot),
    [int]$QuietSeconds = 8
)

$ErrorActionPreference = "Stop"
$Repository = (Resolve-Path -LiteralPath $Repository).Path
$UpdateScript = Join-Path $PSScriptRoot "auto-git-update.ps1"
$LogDirectory = Join-Path $env:LOCALAPPDATA "AiMangaUpscaler"
$LogPath = Join-Path $LogDirectory "auto-git-watch.log"
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

function Write-WatchLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Test-IgnoredEventPath([string]$Path) {
    if (-not $Path) {
        return $true
    }

    $relativePath = [IO.Path]::GetRelativePath($Repository, $Path) -replace "\\", "/"
    return (
        $relativePath -eq "." -or
        $relativePath -match '(^|/)\.git($|/)' -or
        $relativePath -match '(^|/)(\.venv|__pycache__|\.pytest_cache|\.mypy_cache|\.ruff_cache|htmlcov|cache|dist|tmp|temp)($|/)' -or
        $relativePath -match '(^|/)backend/logs($|/)' -or
        $relativePath -match '(^|/)backend/models/.*\.(onnx|download)$' -or
        $relativePath -match '(^|/)desktop\.ini$' -or
        $relativePath -match '\.(log|tmp|temp|pyc)$'
    )
}

function Invoke-Update {
    Write-WatchLog "Running auto Git update."
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $UpdateScript -Repository $Repository
    if ($LASTEXITCODE -eq 0) {
        Write-WatchLog "Auto Git update finished."
    }
    else {
        Write-WatchLog "Auto Git update failed with exit code $LASTEXITCODE."
    }
}

$watcher = [IO.FileSystemWatcher]::new($Repository)
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true
$watcher.NotifyFilter = [IO.NotifyFilters]'FileName, DirectoryName, LastWrite, Size, CreationTime'

$script:PendingUpdate = $false
$script:LastChangeAt = Get-Date

$eventAction = {
    if (Test-IgnoredEventPath $Event.SourceEventArgs.FullPath) {
        return
    }

    $script:PendingUpdate = $true
    $script:LastChangeAt = Get-Date
    Write-WatchLog "Detected change: $($Event.SourceEventArgs.ChangeType) $($Event.SourceEventArgs.FullPath)"
}

$subscriptions = @(
    Register-ObjectEvent -InputObject $watcher -EventName Created -Action $eventAction
    Register-ObjectEvent -InputObject $watcher -EventName Changed -Action $eventAction
    Register-ObjectEvent -InputObject $watcher -EventName Deleted -Action $eventAction
    Register-ObjectEvent -InputObject $watcher -EventName Renamed -Action $eventAction
)

Write-WatchLog "Started auto Git watcher for $Repository."

try {
    while ($true) {
        Start-Sleep -Seconds 1
        if (-not $script:PendingUpdate) {
            continue
        }

        $quietFor = ((Get-Date) - $script:LastChangeAt).TotalSeconds
        if ($quietFor -lt $QuietSeconds) {
            continue
        }

        $script:PendingUpdate = $false
        Invoke-Update
    }
}
finally {
    foreach ($subscription in $subscriptions) {
        Unregister-Event -SubscriptionId $subscription.Id -ErrorAction SilentlyContinue
    }
    $watcher.Dispose()
    Write-WatchLog "Stopped auto Git watcher."
}
