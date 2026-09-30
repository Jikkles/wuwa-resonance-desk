# The half of the refresh GitHub's runners cannot do, run on this PC instead.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/local-run.ps1
#
# Two things only work from a home connection on Windows:
#   - Prydwen answers GitHub Actions with a flat 403, so live kits, weapons
#     (and their icons) and builds only ever arrive from a local run. On patch
#     day that left released Resonators on beta data and new weapons on the
#     placeholder glyph until somebody remembered to run them.
#   - Event banner art before patch day exists only as one tall sheet with the
#     names set as type. find-event-art.mjs --apply reads them with the OCR
#     engine built into Windows, which a Linux runner does not have.
#
# Registered as a scheduled task by scripts/install-local-run.ps1. Costs
# nothing and needs no account: it pushes with the git credentials this
# machine already has. Output goes to %LOCALAPPDATA%\resonance-desk\local-run.log.

$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

$logDir = Join-Path $env:LOCALAPPDATA "resonance-desk"
New-Item -ItemType Directory -Force $logDir | Out-Null
$log = Join-Path $logDir "local-run.log"
# Keep the log to the last few runs.
if ((Test-Path $log) -and (Get-Item $log).Length -gt 2MB) {
  Get-Content $log -Tail 4000 | Set-Content "$log.tmp" -Encoding UTF8
  Move-Item "$log.tmp" $log -Force
}
function Say($msg) { "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')  $msg" | Add-Content $log -Encoding UTF8 }

Say "---- local run starting in $repo"

# A scheduled task does not always inherit the PATH a terminal has.
function Find($exe, $fallback) {
  $c = Get-Command $exe -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  if (Test-Path $fallback) { return $fallback }
  Say "$exe not found"; exit 1
}
$node = Find "node" "$env:ProgramFiles\nodejs\node.exe"
$git = Find "git" "$env:ProgramFiles\Git\cmd\git.exe"
Set-Alias git $git

# Somebody is mid-edit. A bot commit that sweeps up half-finished work is
# worse than a run that waits six hours.
$dirty = git status --porcelain --untracked-files=no
if ($dirty) { Say "working tree has uncommitted changes, skipped:`n$($dirty -join "`n")"; exit 0 }

git pull --rebase --quiet 2>&1 | ForEach-Object { Say "git: $_" }
if ($LASTEXITCODE -ne 0) { Say "pull failed, skipped"; exit 1 }

# Same order as CLAUDE.md's patch-day fix. fetch-client-files decides what is
# unwritten by diffing against the live files, so it runs after them; events
# before the art, because the art fills what the events fetcher left open.
$steps = @(
  "scripts/fetch-kits.mjs",
  "scripts/fetch-weapons.mjs",
  "scripts/fetch-builds.mjs",
  "scripts/fetch-client-files.mjs",
  "scripts/fetch-portraits.mjs",
  "scripts/fetch-events.mjs",
  "scripts/find-event-art.mjs --apply"
)
foreach ($step in $steps) {
  $argv = $step -split " "
  $out = & $node @argv 2>&1
  $code = $LASTEXITCODE
  Say "node $step -> exit $code"
  $out | Select-Object -Last 12 | ForEach-Object { Say "    $_" }
}

git add data assets 2>&1 | Out-Null
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Say "nothing changed"; exit 0 }

$stamp = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mmZ")
git commit --quiet -m "chore: refresh local-only data $stamp" 2>&1 | ForEach-Object { Say "git: $_" }
git pull --rebase --quiet 2>&1 | ForEach-Object { Say "git: $_" }
git push --quiet 2>&1 | ForEach-Object { Say "git: $_" }
if ($LASTEXITCODE -eq 0) { Say "pushed $stamp" } else { Say "push failed — the commit is local, the next run pushes it" }
