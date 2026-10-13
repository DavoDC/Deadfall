# Builds the Deadfall logs ZIP for save-logs.bat. Local only: this script never touches the network.
# Everything is staged in a temp folder, copied with private details scrubbed, zipped, and the temp folder removed.
# Originals are never modified. Env for tests only: DEADFALL_NO_EXPLORER=1 (do not open Explorer), DEADFALL_LOGS_MAX_MB (size cap, default 25).
param([string]$Root)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.IO.Compression.FileSystem

$captures = Join-Path $Root 'app\captures'
$capMB = 25
if ($env:DEADFALL_LOGS_MAX_MB -match '^\d+$') { $capMB = [int]$env:DEADFALL_LOGS_MAX_MB }
$capBytes = [int64]$capMB * 1MB
$maxSessions = 10

# ---- scrubbing: the profile path first (it contains the user name), then the bare names ----
$profilePath = $env:USERPROFILE
$pairs = New-Object System.Collections.ArrayList
if ($profilePath) {
    [void]$pairs.Add(@($profilePath, '%USERPROFILE%'))
    [void]$pairs.Add(@($profilePath.Replace('\', '/'), '%USERPROFILE%'))
    [void]$pairs.Add(@($profilePath.Replace('\', '\\'), '%USERPROFILE%'))
}
foreach ($n in @($env:USERNAME, [Environment]::UserName, $env:COMPUTERNAME)) {
    # very short names would shred ordinary words; the profile path above already covers them in paths
    if ($n -and $n.Length -ge 3) { [void]$pairs.Add(@($n, '<removed>')) }
}
function Protect-Text([string]$text) {
    foreach ($p in $pairs) { $text = [regex]::Replace($text, [regex]::Escape($p[0]), $p[1].Replace('$', '$$'), 'IgnoreCase') }
    return $text
}
function Copy-Scrubbed([string]$from, [string]$to) {
    $text = [IO.File]::ReadAllText($from)
    [IO.File]::WriteAllText($to, (Protect-Text $text), (New-Object Text.UTF8Encoding($false)))
}

# ---- where the ZIP goes ----
$desktop = $null
try { $desktop = [Environment]::GetFolderPath('Desktop') } catch {}
if (-not $desktop -or -not (Test-Path -LiteralPath $desktop)) { $desktop = $Root }
$stampName = Get-Date -Format 'yyyy-MM-dd_HHmm'
$zipPath = Join-Path $desktop ("Deadfall-logs-$stampName.zip")
$n = 2
while (Test-Path -LiteralPath $zipPath) { $zipPath = Join-Path $desktop ("Deadfall-logs-$stampName-$n.zip"); $n++ }

$stage = Join-Path $env:TEMP ('deadfall-logs-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$utf8 = New-Object Text.UTF8Encoding($false)
try {
    # ---- VERSION.txt ----
    $verLine = (& (Join-Path $PSScriptRoot 'version.ps1') -Root $Root | Select-Object -First 1)
    if (-not $verLine -or $verLine -eq 'unknown') { $verText = 'unknown (not a release copy)' } else { $verText = $verLine }
    [IO.File]::WriteAllText((Join-Path $stage 'VERSION.txt'), "$verText`r`n", $utf8)
    Write-Host "  Version ........ $verText"

    # ---- system.txt (no user name, machine name, IP, MAC, serial or paths) ----
    $sys = New-Object System.Collections.ArrayList
    try { $os = Get-CimInstance Win32_OperatingSystem; [void]$sys.Add("Windows: $($os.Caption) version $($os.Version) build $($os.BuildNumber) ($($os.OSArchitecture))"); [void]$sys.Add("RAM: $([math]::Round($os.TotalVisibleMemorySize / 1MB, 1)) GB") } catch { [void]$sys.Add('Windows: could not read') }
    try { [void]$sys.Add('CPU: ' + ((Get-CimInstance Win32_Processor | ForEach-Object { $_.Name.Trim() }) -join ' | ')) } catch { [void]$sys.Add('CPU: could not read') }
    try {
        $gpus = @(Get-CimInstance Win32_VideoController)
        foreach ($g in $gpus) {
            $res = ''
            if ($g.CurrentHorizontalResolution) { $res = ", display $($g.CurrentHorizontalResolution) x $($g.CurrentVerticalResolution)" }
            [void]$sys.Add("GPU: $($g.Name), driver $($g.DriverVersion)$res")
        }
        if ($gpus.Count -eq 0) { [void]$sys.Add('GPU: none found') }
    } catch { [void]$sys.Add('GPU: could not read') }
    try {
        Add-Type -AssemblyName System.Windows.Forms
        [void]$sys.Add('Screens: ' + ((([Windows.Forms.Screen]::AllScreens) | ForEach-Object { "$($_.Bounds.Width) x $($_.Bounds.Height)" }) -join ' | '))
    } catch {}
    try {
        $prog = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\https\UserChoice' -ErrorAction Stop).ProgId
        [void]$sys.Add("Default browser: $prog")
    } catch { [void]$sys.Add('Default browser: could not read') }
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) { [void]$sys.Add('Node.js: ' + (& node -v 2>$null)) } else { [void]$sys.Add('Node.js: not found') }
    [void]$sys.Add('Locale: ' + (Get-Culture).Name)
    try { [void]$sys.Add('Time zone: ' + (Get-TimeZone).Id) } catch {}
    [void]$sys.Add('PowerShell: ' + $PSVersionTable.PSVersion)
    [IO.File]::WriteAllText((Join-Path $stage 'system.txt'), (Protect-Text (($sys -join "`r`n") + "`r`n")), $utf8)
    Write-Host '  System info .... included'

    # ---- launcher.log (the game server writes its output there too) ----
    $logFile = Join-Path $captures 'launcher.log'
    $haveLog = $false
    if (Test-Path -LiteralPath $logFile) {
        $tail = @(Get-Content -LiteralPath $logFile -Tail 5000)
        [IO.File]::WriteAllText((Join-Path $stage 'launcher.log'), (Protect-Text (($tail -join "`r`n") + "`r`n")), $utf8)
        $haveLog = $true
    }
    $serverLogFile = Join-Path $captures 'server.log'
    if (Test-Path -LiteralPath $serverLogFile) {
        Copy-Scrubbed $serverLogFile (Join-Path $stage 'server.log')
    }
    if ($haveLog) { Write-Host '  Game log ....... included' } else { Write-Host '  Game log ....... none yet' }

    # ---- telemetry: newest sessions first, within the size cap ----
    $telDir = Join-Path $captures 'telemetry'
    $sessions = @()
    if (Test-Path -LiteralPath $telDir) {
        $sessions = @(Get-ChildItem -LiteralPath $telDir -Filter 'session-*.json' -File | Where-Object { $_.Name -match '^session-(\d+)\.json$' } |
            Sort-Object { [int64]($_.Name -replace '\D', '') } -Descending)
    }
    $used = [int64]0
    $sessIncluded = 0; $sessSkipped = 0; $framesIncluded = 0; $framesSkipped = 0
    $teleStage = Join-Path $stage 'telemetry'
    foreach ($s in $sessions) {
        $id = $s.Name -replace '\D', ''
        $fd = Join-Path $telDir "frames\$id"
        if ($sessIncluded -ge $maxSessions -or ($used + $s.Length) -gt $capBytes) {
            $sessSkipped++
            if (Test-Path -LiteralPath $fd) { $framesSkipped += @(Get-ChildItem -LiteralPath $fd -File).Count }
            continue
        }
        New-Item -ItemType Directory -Path $teleStage -Force | Out-Null
        Copy-Scrubbed $s.FullName (Join-Path $teleStage $s.Name)
        $used += $s.Length; $sessIncluded++
        if (Test-Path -LiteralPath $fd) {
            $dest = Join-Path $teleStage "frames\$id"
            foreach ($f in (Get-ChildItem -LiteralPath $fd -File | Sort-Object LastWriteTime -Descending)) {
                if (($used + $f.Length) -gt $capBytes) { $framesSkipped++; continue }
                New-Item -ItemType Directory -Path $dest -Force | Out-Null
                Copy-Item -LiteralPath $f.FullName -Destination (Join-Path $dest $f.Name)
                $used += $f.Length; $framesIncluded++
            }
        }
    }
    if ($sessions.Count -eq 0) {
        $teleNote = 'No playtest data yet (no play sessions were recorded on this computer).'
        Write-Host '  Playtest data .. no playtest data yet'
    } else {
        $teleNote = "Play sessions: $sessIncluded included, $sessSkipped skipped (size cap $capMB MB, newest first). Screenshots: $framesIncluded included, $framesSkipped skipped."
        Write-Host "  Playtest data .. $sessIncluded of $($sessions.Count) sessions, $framesIncluded screenshots ($sessSkipped sessions skipped for size)"
    }

    # ---- README.txt ----
    $readme = @(
        'Deadfall logs',
        '',
        'This ZIP was made by scripts\save-logs.bat. Nothing was sent anywhere: it is a plain file on your computer.',
        'Your Windows user name, computer name and user folder path were removed from the text files.',
        '',
        'VERSION.txt .................. which build of the game you have (commit id and date)',
        'system.txt ................... Windows version, CPU, RAM, graphics card(s), screen size, default browser, Node.js, language and time zone',
        'launcher.log ................. what the launcher and the game server did (the server writes its output here too)',
        'telemetry\session-*.json ..... one file per play session: deaths, damage, frame rate, where you went',
        'telemetry\frames\ ............ small screenshots taken during play (newest first)',
        '',
        $teleNote
    )
    [IO.File]::WriteAllText((Join-Path $stage 'README.txt'), (($readme -join "`r`n") + "`r`n"), $utf8)

    # ---- zip ----
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath)
} finally {
    Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
}

$sizeKB = [math]::Round((Get-Item -LiteralPath $zipPath).Length / 1KB)
Write-Host ''
Write-Host "  File: $(Split-Path -Leaf $zipPath) ($sizeKB KB)"
if ($env:DEADFALL_NO_EXPLORER -ne '1') {
    try { Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('/select,"' + $zipPath + '"') } catch {}
}
