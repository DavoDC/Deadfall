# Downloads the newest Deadfall ZIP for update.bat and unpacks it, showing a dot every second so the window never looks frozen.
# Built-in tools only (PowerShell 5.1). The size and time taken are appended to the update log when env DF_LOGFILE is set.
# Exit code 0 = unpacked into -Extract, 1 = the download or unpack failed (the reason is printed).
param([string]$Url, [string]$Zip, [string]$Extract)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
function Write-Detail([string]$text) {
    if ($env:DF_LOGFILE) { try { Add-Content -LiteralPath $env:DF_LOGFILE -Value $text -Encoding UTF8 } catch {} }
}
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    $clock = [Diagnostics.Stopwatch]::StartNew()
    # the download runs in a background job so this window can keep printing progress
    $job = Start-Job -ScriptBlock {
        param($u, $o)
        $ProgressPreference = 'SilentlyContinue'
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $o
    } -ArgumentList $Url, $Zip
    while ($job.State -eq 'Running') {
        Write-Host -NoNewline '.'
        Start-Sleep -Seconds 1
    }
    Write-Host ''
    Receive-Job -Job $job -ErrorAction Stop | Out-Null
    if ($job.State -ne 'Completed') { throw 'the download did not finish' }
    Remove-Job -Job $job -Force
    $bytes = (Get-Item -LiteralPath $Zip).Length
    $secs = [math]::Round($clock.Elapsed.TotalSeconds, 1)
    Write-Detail "[update] download ok: $bytes bytes in $secs s"
    Expand-Archive -LiteralPath $Zip -DestinationPath $Extract -Force
    Write-Detail "[update] unpacked ok after $([math]::Round($clock.Elapsed.TotalSeconds, 1)) s"
} catch {
    Write-Host ''
    Write-Host $_.Exception.Message
    Write-Detail "[update] download failed: $($_.Exception.Message)"
    exit 1
}
exit 0
