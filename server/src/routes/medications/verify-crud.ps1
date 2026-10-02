param(
  [string]$Base = 'http://127.0.0.1:3000',
  [string]$Token = $env:MEDITRACK_ACCESS_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'Set MEDITRACK_ACCESS_TOKEN to a signed-in test patient access token.' }
$Base = $Base.TrimEnd('/')

# Uses curl.exe explicitly (PowerShell's curl alias is not used).
# A UTF-8 file avoids Windows command-line JSON quoting differences.
function Invoke-CrudCurl([string]$Method, [string]$Path, $Body = $null, [int]$Expected = 200) {
  $taskBodyFile = [IO.Path]::GetTempFileName()
  try {
    $curlArgs = @('--silent', '--show-error', '--max-time', '20', '-X', $Method,
      "$Base/api$Path", '-H', "Authorization: Bearer $Token", '-w', "`n%{http_code}")
    if ($null -ne $Body) {
      [IO.File]::WriteAllText($taskBodyFile, ($Body | ConvertTo-Json -Depth 10 -Compress), [Text.UTF8Encoding]::new($false))
      $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$taskBodyFile")
    }
    $output = (& curl.exe @curlArgs) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "curl failed: $Method $Path" }
    $parts = $output -split "`n"
    $httpStatus = [int]$parts[-1]
    $json = ($parts | Select-Object -SkipLast 1) -join "`n"
    if ($httpStatus -ne $Expected) { throw "$Method $Path returned $httpStatus (expected $Expected): $json" }
    Write-Host "$Method $Path -> $httpStatus"
    if ($json.Trim()) { return ($json | ConvertFrom-Json) }
  } finally { Remove-Item -LiteralPath $taskBodyFile -ErrorAction SilentlyContinue }
}
function Assert-Value($Actual, $Expected, [string]$Label) {
  if ($Actual -cne $Expected) { throw "$Label expected '$Expected', received '$Actual'." }
}

$doctor = Invoke-CrudCurl POST '/doctors' @{ doctorName = 'Phase 5 curl doctor'; specialization = 'General'; clinicHospitalName = 'Test clinic'; contactNumber = '1234567890'; address = 'Test address' } 201
Assert-Value $doctor.source 'manual' 'Doctor source'
$null = Invoke-CrudCurl GET '/doctors'
$null = Invoke-CrudCurl GET "/doctors/$($doctor.id)"
$updated = Invoke-CrudCurl PATCH "/doctors/$($doctor.id)" @{ specialization = 'Updated specialization' }
Assert-Value $updated.specialization 'Updated specialization' 'Doctor update'

# Read the SAME client lookup used by manual entry and OCR, then verify persisted values.
$lookupPath = Join-Path $PSScriptRoot '../../../../client/src/pages/medications/medicineForm.js'
$lookupUrl = ([Uri](Resolve-Path $lookupPath).Path).AbsoluteUri
$lookupJson = & node --input-type=module -e 'const m = await import(process.argv[1]); console.log(JSON.stringify(m.trackingByForm));' $lookupUrl
if ($LASTEXITCODE -ne 0) { throw 'Unable to load the client lookup.' }
$lookup = $lookupJson | ConvertFrom-Json
$created = @()
foreach ($example in @(@('tablet', 'countable'), @('syrup', 'volume_ml'), @('ointment', 'weight_grams'))) {
  $form = $example[0]
  $medicine = Invoke-CrudCurl POST '/medications' @{
    medicineName = "Phase 5 curl $form"; genericName = 'Test generic'; medicineForm = $form
    trackingType = $lookup.$form; dosageAmount = '1'; dosageUnit = 'unit'; frequencyText = 'Daily'
    instructions = 'Test record'; startDate = '2026-10-02'; endDate = $null; doctorId = $doctor.id
  } 201
  $created += $medicine
  $detail = Invoke-CrudCurl GET "/medications/$($medicine.id)"
  Assert-Value $detail.trackingType $example[1] "$form persisted trackingType"
  Assert-Value $detail.addedVia 'manual' 'Medication origin'
  foreach ($field in @('schedules', 'inventory', 'doseLogs', 'aiInsights')) {
    if ($detail.PSObject.Properties.Name -notcontains $field) { throw "Detail is missing $field" }
  }
  Write-Host "PROOF: $form -> $($detail.trackingType) (read from saved medication #$($medicine.id))"
  $updated = Invoke-CrudCurl PATCH "/medications/$($medicine.id)" @{ instructions = 'Edited with curl'; status = 'completed' }
  Assert-Value $updated.instructions 'Edited with curl' 'Medication update'
  Assert-Value $updated.status 'completed' 'Medication status'
}
$null = Invoke-CrudCurl GET '/medications'
$null = Invoke-CrudCurl GET '/medications?status=completed'
# Human override remains supported.
$override = Invoke-CrudCurl PATCH "/medications/$($created[0].id)" @{ trackingType = 'weight_grams' }
Assert-Value $override.trackingType 'weight_grams' 'Human tracking override'
$null = Invoke-CrudCurl DELETE "/doctors/$($doctor.id)" $null 204
$null = Invoke-CrudCurl GET "/doctors/$($doctor.id)" $null 404
foreach ($medicine in $created) {
  $detail = Invoke-CrudCurl GET "/medications/$($medicine.id)"
  if ($null -ne $detail.doctorId) { throw 'Deleting doctor should clear the optional doctor link.' }
  $deleted = Invoke-CrudCurl DELETE "/medications/$($medicine.id)"
  Assert-Value $deleted.status 'discontinued' 'Medication soft delete'
  $detail = Invoke-CrudCurl GET "/medications/$($medicine.id)"
  Assert-Value $detail.status 'discontinued' 'Persisted soft delete'
}
$null = Invoke-CrudCurl GET '/medications?status=discontinued'
Write-Host 'PASS: Full CRUD for Medication and Doctor, three tracking defaults, override, and detail relations.'
Write-Host 'The three test medications remain as discontinued records; the test doctor was deleted.'
