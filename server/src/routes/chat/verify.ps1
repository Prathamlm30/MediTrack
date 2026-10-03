param(
  [string]$Base = 'http://127.0.0.1:3000',
  [string]$Token = $env:MEDITRACK_ACCESS_TOKEN
)
$ErrorActionPreference = 'Stop'
if (-not $Token) { throw 'Set MEDITRACK_ACCESS_TOKEN to a signed-in TEST patient access token.' }
$Base = $Base.TrimEnd('/')

# curl.exe with JSON files works in Windows PowerShell 5 and PowerShell 7.
function Invoke-Phase10Curl([string]$Method, [string]$Path, $Body = $null, [int]$Expected = 200) {
  $taskBodyFile = [IO.Path]::GetTempFileName()
  try {
    $curlArgs = @('--silent', '--show-error', '--max-time', '60', '-X', $Method,
      "$Base/api$Path", '-H', "Authorization: Bearer $Token", '-w', "`n%{http_code}")
    if ($null -ne $Body) {
      [IO.File]::WriteAllText($taskBodyFile, ($Body | ConvertTo-Json -Depth 10 -Compress), [Text.UTF8Encoding]::new($false))
      $curlArgs += @('-H', 'Content-Type: application/json', '--data-binary', "@$taskBodyFile")
    }
    $output = (& curl.exe @curlArgs) -join "`n"
    if ($LASTEXITCODE -ne 0) { throw "curl failed: $Method $Path" }
    $parts = $output -split "`n"
    $status = [int]$parts[-1]
    $json = ($parts | Select-Object -SkipLast 1) -join "`n"
    if ($status -ne $Expected) { throw "$Method $Path returned ${status}: $json" }
    Write-Host "$Method $Path -> $status"
    return ($json | ConvertFrom-Json)
  } finally { Remove-Item -LiteralPath $taskBodyFile -ErrorAction SilentlyContinue }
}

$conversation = Invoke-Phase10Curl POST '/chat/conversations' @{} 201
foreach ($message in @('How can I remember my medication?', 'Tell me about the rings of Saturn.')) {
  $reply = Invoke-Phase10Curl POST "/chat/conversations/$($conversation.id)/messages" @{ messageText = $message } 201
  if (-not $reply.userMessage.disclaimerShown -or -not $reply.aiMessage.disclaimerShown) { throw 'Missing stored disclaimer flag.' }
  Write-Host "Message: $message"
  Write-Host ($reply | ConvertTo-Json -Depth 10)
}
$history = Invoke-Phase10Curl GET "/chat/conversations/$($conversation.id)/messages"
if ($history.messages.Count -ne 4 -or @($history.messages | Where-Object { $_.disclaimerShown -ne $true }).Count) { throw 'History disclaimer check failed.' }

$medications = @()
foreach ($name in @('SIMVASTATIN', 'cLaRiThRoMyCiN')) {
  # Synthetic fixture quantities only; this script creates records, not prescribing instructions.
  $medications += Invoke-Phase10Curl POST '/medications' @{
    medicineName = $name; medicineForm = 'tablet'; trackingType = 'countable'; dosageAmount = 1
    dosageUnit = 'tablet'; frequencyText = 'daily'; startDate = (Get-Date -Format 'yyyy-MM-dd')
  } 201
}
$combined = Invoke-Phase10Curl GET '/insights'
$matching = @($combined.interactionFlags | Where-Object {
  $_.medicationId1 -eq $medications[0].id -and $_.medicationId2 -eq $medications[1].id
})
if ($matching.Count -ne 1 -or -not $matching[0].interaction.sourceReference.Contains('https://')) { throw 'Automatic sourced interaction flag missing.' }
Write-Host ($matching[0] | ConvertTo-Json -Depth 10)
Write-Host "PASS: stored user/AI disclaimers, non-medication question and automatic interaction flag."
Write-Host "Read the same rows directly with Prisma (from server/):"
Write-Host "node src/routes/chat/verify-stored.mjs $($conversation.id) $($medications[0].patientId)"
Write-Host 'These test patient records are retained for inspection.'
