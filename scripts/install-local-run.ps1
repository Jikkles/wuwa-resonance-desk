# Registers scripts/local-run.ps1 as a Windows scheduled task: every 6 hours,
# plus as soon as the PC is next on if a run was missed. Runs as you, only
# while you are logged in, so it needs no stored password.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-run.ps1
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local-run.ps1 -Remove

param([switch]$Remove)
$name = "Resonance Desk local refresh"

if ($Remove) {
  Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  "removed '$name'"
  return
}

$script = Join-Path $PSScriptRoot "local-run.ps1"
$action = New-ScheduledTaskAction -Execute "powershell.exe" `
  -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$script`""
# 30 minutes after the GitHub feeds cron (02/08/14/20 UTC), so a local run
# lands on top of the newest bot commit rather than racing it.
$start = [DateTime]::UtcNow.Date.AddHours(2).AddMinutes(30).ToLocalTime()
$trigger = New-ScheduledTaskTrigger -Once -At $start -RepetitionInterval (New-TimeSpan -Hours 6)
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings `
  -Principal $principal -Description "Runs the Prydwen fetchers and the event-art OCR for the Resonance Desk, then pushes. See scripts/local-run.ps1." `
  -Force | Out-Null
"registered '$name' — every 6 hours from $($start.ToString('HH:mm')), log at $env:LOCALAPPDATA\resonance-desk\local-run.log"
