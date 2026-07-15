param(
    [string]$Repository = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = "Stop"
$Repository = (Resolve-Path -LiteralPath $Repository).Path
$LogDirectory = Join-Path $env:LOCALAPPDATA "AiMangaUpscaler"
$LogPath = Join-Path $LogDirectory "auto-git-update.log"
New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null

function Write-UpdateLog([string]$Message) {
    $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $Message
    Add-Content -LiteralPath $LogPath -Value $line -Encoding UTF8
}

function Invoke-Git([Parameter(ValueFromRemainingArguments = $true)][string[]]$GitArgs) {
    $previousErrorAction = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $output = & git -C $Repository @GitArgs 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    if ($exitCode -ne 0) {
        throw "git $($GitArgs -join ' ') failed: $($output -join [Environment]::NewLine)"
    }
    return $output
}

function Add-ExactIgnore([string]$RelativePath) {
    $ignorePath = Join-Path $Repository ".gitignore"
    $entry = "/" + ($RelativePath -replace "\\", "/")
    $existing = Get-Content -LiteralPath $ignorePath -ErrorAction SilentlyContinue
    if ($existing -notcontains $entry) {
        Add-Content -LiteralPath $ignorePath -Value $entry -Encoding UTF8
        Write-UpdateLog "Ignored sensitive local file: $RelativePath"
    }
}

$createdNew = $false
$mutex = [Threading.Mutex]::new($true, "Local\AiMangaUpscalerGitUpdate", [ref]$createdNew)
if (-not $createdNew) {
    Write-UpdateLog "Skipped because another update is running."
    exit 0
}

try {
    Write-UpdateLog "Starting repository update."
    Invoke-Git rev-parse --is-inside-work-tree | Out-Null

    $namePattern = '(?i)(^|/)(\.env($|\.)|credentials?($|\.)|secrets?($|\.)|tokens?($|\.)|id_rsa|id_ed25519|desktop\.ini$)|\.(pem|key|pfx|p12|sqlite3?|db)$'
    $secretPattern = '(AIza[0-9A-Za-z_-]{35}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{20,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----)'

    $untracked = @(Invoke-Git ls-files --others --exclude-standard)
    foreach ($relativePath in $untracked) {
        if (-not $relativePath) { continue }
        $fullPath = Join-Path $Repository $relativePath
        $sensitiveName = $relativePath -match $namePattern
        $sensitiveContent = $false
        if (-not $sensitiveName -and (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
            $sensitiveContent = [bool](Select-String -LiteralPath $fullPath -Pattern $secretPattern -Quiet -ErrorAction SilentlyContinue)
        }
        if ($sensitiveName -or $sensitiveContent) {
            Add-ExactIgnore $relativePath
        }
    }

    $trackedFiles = @(Invoke-Git ls-files)
    foreach ($relativePath in $trackedFiles) {
        if (-not $relativePath) { continue }
        $fullPath = Join-Path $Repository $relativePath
        if ($relativePath -match '(?i)(^|/)desktop\.ini$') {
            Invoke-Git rm --cached -- $relativePath | Out-Null
            Write-UpdateLog "Removed Windows metadata from Git tracking: $relativePath"
            continue
        }
        if ((Test-Path -LiteralPath $fullPath -PathType Leaf) -and
            (Select-String -LiteralPath $fullPath -Pattern $secretPattern -Quiet -ErrorAction SilentlyContinue)) {
            throw "Possible secret detected in tracked file '$relativePath'. Nothing was committed or pushed."
        }
    }

    Invoke-Git add -A | Out-Null
    $staged = & git -C $Repository diff --cached --quiet
    if ($LASTEXITCODE -eq 0) {
        Write-UpdateLog "No safe changes to commit."
        exit 0
    }
    if ($LASTEXITCODE -ne 1) {
        throw "Unable to inspect staged changes."
    }

    $message = "chore(auto): sync files {0}" -f (Get-Date -Format "yyyy-MM-dd HH:mm")
    Invoke-Git commit -m $message | Out-Null
    Invoke-Git push | Out-Null
    Write-UpdateLog "Committed and pushed safe changes."
}
catch {
    Write-UpdateLog "ERROR: $($_.Exception.Message)"
    exit 1
}
finally {
    $mutex.ReleaseMutex()
    $mutex.Dispose()
}
