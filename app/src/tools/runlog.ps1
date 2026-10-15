# Runs one of the user-facing .bat scripts and keeps a copy of everything it prints in app\logs\<name>-<yyyy-MM-dd>.log.
# Local only, built-in tools only. The script's output still appears live in the window (prompts included).
# The log is appended with a timestamped run header (Windows, PowerShell, Node, version) and the exit code at the end,
# and any log in that folder over about 1 MB is trimmed to its newest half. On failure the log path is printed.
# Called by the .bat itself (DF_LOGGED=1 stops it wrapping twice). Arguments of the .bat arrive in env DF_ARGS.
param([string]$Name, [string]$Script, [string]$Root)
$ErrorActionPreference = 'Continue'
$Root = [IO.Path]::GetFullPath($Root)
$logs = Join-Path $Root 'app\logs'
New-Item -ItemType Directory -Path $logs -Force | Out-Null
$logFile = Join-Path $logs ("$Name-" + (Get-Date -Format 'yyyy-MM-dd') + '.log')

# ---- trim anything over the cap (a log held open by the running server is skipped quietly) ----
$cap = 1MB
foreach ($f in (Get-ChildItem -LiteralPath $logs -Filter '*.log' -File -ErrorAction SilentlyContinue)) {
    if ($f.Length -gt $cap) {
        try {
            $bytes = [IO.File]::ReadAllBytes($f.FullName)
            $keep = [int]($cap / 2)
            $slice = New-Object byte[] $keep
            [Array]::Copy($bytes, $bytes.Length - $keep, $slice, 0, $keep)
            $text = [Text.Encoding]::UTF8.GetString($slice)
            $nl = $text.IndexOf("`n")
            if ($nl -ge 0) { $text = $text.Substring($nl + 1) }
            [IO.File]::WriteAllText($f.FullName, "[log trimmed to its newest part]`r`n" + $text, (New-Object Text.UTF8Encoding($false)))
        } catch {}
    }
}

$utf8 = New-Object Text.UTF8Encoding($false)
$fs = New-Object IO.FileStream($logFile, [IO.FileMode]::Append, [IO.FileAccess]::Write, [IO.FileShare]::ReadWrite)
$log = New-Object IO.StreamWriter($fs, $utf8)
$log.AutoFlush = $true

# ---- run header ----
$verLine = 'unknown'
try { $verLine = (& (Join-Path $PSScriptRoot 'version.ps1') -Root $Root | Select-Object -First 1) } catch {}
$osCaption = ''
try { $o = Get-CimInstance Win32_OperatingSystem; $osCaption = "$($o.Caption) build $($o.BuildNumber)" } catch {}
$nodeVer = 'not found'
$nc = Get-Command node -ErrorAction SilentlyContinue
if ($nc) { try { $nodeVer = (& node -v 2>$null) } catch {} }
$argLine = $env:DF_ARGS
$log.WriteLine('')
$log.WriteLine("===== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $Name run: $(Split-Path -Leaf $Script) $argLine =====")
$log.WriteLine("version $verLine")
$log.WriteLine("Windows $osCaption, PowerShell $($PSVersionTable.PSVersion), Node.js $nodeVer")

# ---- run the script, tee its output ----
$psi = New-Object Diagnostics.ProcessStartInfo
$psi.FileName = Join-Path $env:SystemRoot 'System32\cmd.exe'
$psi.Arguments = '/c ""' + $Script + '" ' + $argLine + '"'
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [Console]::OutputEncoding
$psi.StandardErrorEncoding = [Console]::OutputEncoding
$psi.EnvironmentVariables['DF_LOGGED'] = '1'
# the .bat appends its own detail lines (old and new version, copy results) to this side file (cmd cannot append to a file
# this script holds open); the lines are copied into the real log below, just before the exit code
$detailFile = Join-Path $logs ("$Name-detail.tmp")
Remove-Item -LiteralPath $detailFile -Force -ErrorAction SilentlyContinue
$psi.EnvironmentVariables['DF_LOGFILE'] = $detailFile
$clock = [Diagnostics.Stopwatch]::StartNew()
$p = [Diagnostics.Process]::Start($psi)
# stderr is merged into the same stream by the .bat's own redirects; anything left is drained to the log too
$errTask = $p.StandardError.ReadToEndAsync()
$reader = $p.StandardOutput
$buf = New-Object char[] 512
$task = $reader.ReadAsync($buf, 0, $buf.Length)
$line = New-Object Text.StringBuilder
$idleAfterExit = 0
while ($true) {
    if ($task.Wait(200)) {
        $n = $task.Result
        if ($n -le 0) { break }
        $chunk = New-Object string($buf, 0, $n)
        [Console]::Out.Write($chunk)
        [void]$line.Append($chunk)
        $s = $line.ToString()
        $cut = $s.LastIndexOf("`n")
        if ($cut -ge 0) {
            $log.Write($s.Substring(0, $cut + 1).Replace("`r`n", "`n").Replace("`n", "`r`n"))
            [void]$line.Clear(); [void]$line.Append($s.Substring($cut + 1))
        }
        $task = $reader.ReadAsync($buf, 0, $buf.Length)
        $idleAfterExit = 0
    } elseif ($p.HasExited) {
        # a child (for example the browser) may still hold the pipe open: stop waiting after a short grace period
        $idleAfterExit++
        if ($idleAfterExit -ge 5) { break }
    }
}
$p.WaitForExit()
if ($line.Length -gt 0) { $log.Write($line.ToString()); $log.WriteLine('') }
$rc = $p.ExitCode
$stderr = ''
try { if ($errTask.Wait(500)) { $stderr = $errTask.Result } } catch {}
if ($stderr) { [Console]::Error.Write($stderr); $log.WriteLine($stderr.TrimEnd()) }
if (Test-Path -LiteralPath $detailFile) {
    try { foreach ($d in (Get-Content -LiteralPath $detailFile)) { $log.WriteLine($d) } } catch {}
    Remove-Item -LiteralPath $detailFile -Force -ErrorAction SilentlyContinue
}
$secs = [math]::Round($clock.Elapsed.TotalSeconds, 1)
$log.WriteLine("exit code $rc after $secs s")
if ($rc -ne 0) {
    $msg = "  The details were saved to: $logFile"
    Write-Host $msg
    $log.WriteLine($msg)
}
$log.Dispose()
exit $rc
