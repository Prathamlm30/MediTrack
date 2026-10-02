param([string]$ApiOrigin = 'http://127.0.0.1:3000')
$ErrorActionPreference = 'Stop'
Push-Location (Resolve-Path (Join-Path $PSScriptRoot '../../..'))
$watcher = $null
$oldToken = $env:ACCESS_TOKEN
$oldOrigin = $env:TEST_API_ORIGIN
$grace = $null
$liveOutput = Join-Path ([IO.Path]::GetTempPath()) ('phase9-live-' + [guid]::NewGuid() + '.log')
$liveError = $liveOutput + '.err'
try {
  # Creates isolated dev users, real dose/stat rows and pending invitations.
  # No relationship exists until the curl invitation acceptance below.
  $demo = node src/routes/caregiver/demo.mjs | ConvertFrom-Json
  if ($LASTEXITCODE -ne 0) { throw 'Fixture creation failed.' }
  $caregiver = "Authorization: Bearer $($demo.caregiverToken)"
  foreach ($patient in $demo.patients) {
    $accepted = curl.exe --silent --show-error --fail-with-body -X POST "$ApiOrigin/api/invitations/$($patient.invitationToken)/accept" -H $caregiver | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw 'Invitation acceptance failed.' }
    '{"permissionLevel":"full_access"}' | curl.exe --silent --show-error --fail-with-body -X PATCH "$ApiOrigin/api/relationships/$($accepted.relationship.id)/permissions" -H "Authorization: Bearer $($patient.token)" -H 'Content-Type: application/json' --data-binary '@-'
    if ($LASTEXITCODE -ne 0) { throw 'Permission update failed.' }
  }
  curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/caregiver/patients" -H $caregiver
  foreach ($patient in @($demo.patients[0], $demo.patients[1], $demo.patients[0])) {
    $dashboard = curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/dashboard/caregiver/$($patient.id)" -H $caregiver | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $dashboard.patient.id -ne $patient.id) { throw 'Patient switch failed.' }
    Write-Output "SWITCH patient=$($dashboard.patient.id) name=$($dashboard.patient.fullName)"
  }
  # Reuse the Phase 8 socket watcher, one connection for both patients.
  $env:ACCESS_TOKEN = $demo.caregiverToken
  $env:TEST_API_ORIGIN = $ApiOrigin
  $watcher = Start-Process -FilePath (Get-Command node).Source -ArgumentList 'src/routes/escalations/watch-alerts.mjs' -WindowStyle Hidden -PassThru -RedirectStandardOutput $liveOutput -RedirectStandardError $liveError
  for ($i = 0; $i -lt 50; $i++) {
    if ((Test-Path $liveOutput) -and (Select-String -LiteralPath $liveOutput -Pattern 'Connected.' -Quiet)) { break }
    Start-Sleep -Milliseconds 100
  }
  if (!(Select-String -LiteralPath $liveOutput -Pattern 'Connected.' -Quiet)) { throw 'Socket watcher did not connect.' }
  $grace = (curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/escalation-settings" -H $caregiver | ConvertFrom-Json).gracePeriodMinutes
  '{"gracePeriodMinutes":0.05}' | curl.exe --silent --show-error --fail-with-body -X PATCH "$ApiOrigin/api/escalation-settings" -H $caregiver -H 'Content-Type: application/json' --data-binary '@-'
  foreach ($patient in $demo.patients) {
    (@{scheduleId=$patient.scheduleId} | ConvertTo-Json -Compress) | curl.exe --silent --show-error --fail-with-body -X POST "$ApiOrigin/api/escalations/dev/overdue-dose" -H $caregiver -H 'Content-Type: application/json' --data-binary '@-'
    (@{patientId=$patient.id} | ConvertTo-Json -Compress) | curl.exe --silent --show-error --fail-with-body -X POST "$ApiOrigin/api/escalations/jobs/run" -H $caregiver -H 'Content-Type: application/json' --data-binary '@-'
  }
  Start-Sleep -Seconds 4
  foreach ($patient in $demo.patients) {
    (@{patientId=$patient.id} | ConvertTo-Json -Compress) | curl.exe --silent --show-error --fail-with-body -X POST "$ApiOrigin/api/escalations/jobs/run" -H $caregiver -H 'Content-Type: application/json' --data-binary '@-'
  }
  $feed = curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/caregiver/alerts-feed" -H $caregiver | ConvertFrom-Json
  foreach ($patient in $demo.patients) {
    if ($patient.id -notin $feed.patientId) { throw "Feed missing patient $($patient.id)." }
  }
  Start-Sleep -Milliseconds 200
  Get-Content -LiteralPath $liveOutput
  if (@(Select-String -LiteralPath $liveOutput -Pattern '^missed-dose-alert').Count -ne 2) { throw 'Expected two live alerts on the same connection.' }
  '{}' | curl.exe --silent --show-error --fail-with-body -X POST "$ApiOrigin/api/reports/weekly/jobs/run" -H $caregiver -H 'Content-Type: application/json' --data-binary '@-'
  if ($LASTEXITCODE -ne 0) { throw 'Weekly report generation failed.' }
  foreach ($patient in $demo.patients) {
    $reports = @(curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/reports/weekly?patientId=$($patient.id)" -H $caregiver | ConvertFrom-Json)
    $report = curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/reports/weekly/$($reports[0].id)" -H $caregiver | ConvertFrom-Json
    $rows = @(curl.exe --silent --show-error --fail-with-body "$ApiOrigin/api/dose-logs?patientId=$($patient.id)" -H $caregiver | ConvertFrom-Json)
    $weeklyRows = @($rows | Where-Object { [datetime]$_.scheduledDatetime -ge [datetime]$report.weekStartDate -and [datetime]$_.scheduledDatetime -lt [datetime]$report.weekEndDate })
    $missed = @($weeklyRows | Where-Object status -eq 'missed').Count
    if (!$report.summaryText.Contains("The patient missed $missed ") -or $report.sentStatus -ne 'sent') { throw 'Report did not match source rows or was not delivered.' }
    Write-Output "REPORT id=$($report.id) patient=$($patient.id) sentStatus=$($report.sentStatus)"
    $weeklyRows | Select-Object id,status,scheduledDatetime | Format-Table
    Write-Output $report.summaryText
  }
  Write-Output "Demo records retained: caregiver=$($demo.caregiverId), patients=$($demo.patients.id -join ',')."
} finally {
  if ($null -ne $grace) {
    (@{gracePeriodMinutes=$grace} | ConvertTo-Json -Compress) | curl.exe --silent --show-error --fail-with-body -X PATCH "$ApiOrigin/api/escalation-settings" -H $caregiver -H 'Content-Type: application/json' --data-binary '@-' | Out-Null
  }
  if ($watcher -and !$watcher.HasExited) { Stop-Process -Id $watcher.Id }
  $env:ACCESS_TOKEN = $oldToken
  $env:TEST_API_ORIGIN = $oldOrigin
  Pop-Location
}
