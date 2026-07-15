param(
    [switch]$Fast
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$Python = Join-Path $Root ".venv\Scripts\python.exe"

if (-not (Test-Path -LiteralPath $Python)) {
    throw "Virtual environment not found at $Python"
}

Push-Location $Root
try {
    & $Python -m pytest -q
    if ($LASTEXITCODE -ne 0) { throw "pytest failed" }

    npm test
    if ($LASTEXITCODE -ne 0) { throw "extension checks failed" }

    if (-not $Fast) {
        & $Python -m ruff check backend
        if ($LASTEXITCODE -ne 0) { throw "ruff failed" }

        & $Python -m coverage run -m pytest -q
        if ($LASTEXITCODE -ne 0) { throw "coverage test run failed" }
        & $Python -m coverage report --fail-under=45
        if ($LASTEXITCODE -ne 0) { throw "branch coverage is below the baseline" }
    }
}
finally {
    Pop-Location
}
