# Prints the build version as "<sha> <date>", or the word unknown. Used by launch.bat, update.bat and save-logs.bat.
# Same rules as src/server/version.js: a stamped app\VERSION (GitHub ZIP) wins; a git clone falls back to git, if installed.
param([string]$Root)
$sha = $null; $date = $null
$file = Join-Path $Root 'app\VERSION'
if (Test-Path -LiteralPath $file) {
    $text = Get-Content -LiteralPath $file -Raw
    if ($text -match '^\s*([0-9a-fA-F]{40})\s+(\S+)') { $sha = $Matches[1].ToLower(); $date = $Matches[2] }
}
if (-not $sha -and (Get-Command git -ErrorAction SilentlyContinue)) {
    $h = (& git -C $Root rev-parse HEAD 2>$null | Select-Object -First 1)
    if ($h -match '^[0-9a-fA-F]{40}$') {
        $sha = $h.ToLower()
        $date = (& git -C $Root log -1 --format=%cI 2>$null | Select-Object -First 1)
        if (-not $date) { $date = 'unknown-date' }
    }
}
if ($sha) { "$sha $date" } else { 'unknown' }
