# Phase 4 — Prescription scanning

## Deliverable and verified result

> Deliverable: Uploading a real prescription photo produces a reviewable, editable structured form via the PaddleOCR pipeline; confirming it creates real Medication and Doctor rows in Postgres.

Source: `docs/MediTrack_Roadmap_v3.pdf`, Phase 4, page 14.

Verified on 2026-10-01 with the actual supplied JPEGs, real PaddleOCR, Gemini,
HTTP, Socket.io, disk storage and PostgreSQL. No mocked OCR or database responses.
These are the benchmark's synthetic prescription images; this verification does
not establish accuracy on clinical handwriting or repeat the benchmark CER study.

| Fixture | 202 response | Upload through scan-complete | Native confidence | Medicines |
| --- | ---: | ---: | ---: | ---: |
| rx_01.jpg | 13 ms | 10.442 s | 0.989516963561376 | 4 |
| rx_04.jpg | 12 ms | 11.062 s | 0.9890428185462952 | 5 |
| rx_08.jpg | 17 ms | 8.237 s | 0.9862076469830104 | 6 |

All three first reached `needs_review`, with no Doctor/Medication rows created.
Confirming rx_04 scan **5** created Doctor **2** and Medications **32–36** for
test patient **101**. Concurrent duplicate confirmation returned 409 without
duplicating rows. The browser test then uploaded rx_04 as scan **8**, edited the
first instruction, and created Medications **37–41**, reusing Doctor **2**.
The edited instruction was verified directly in Postgres.

Evidence: `tests/results/rx_04.json` contains the complete extracted contract and
raw transcript. `verification.json` records the API run; `ui-verification.json`
records browser confirmation. The two review PNGs show desktop and mobile layouts.
An additional literal `curl.exe` upload received the real socket event and left
scan **9** in `needs_review` with five medicines (`curl-verification.json`).
Open `http://localhost:5173/prescription-scans/9` after signing into the demo account
to inspect a review form that is still awaiting confirmation.

Other checks passed: all caregiver permission levels and revocation, unsigned
image denial, required review acknowledgement, invalid medicine form rejection,
reference-code integrity, enum parity, required dependency pins, existing dashboard
integration tests, client API tests, and the Vite production build.

## Implementation details

- `preprocessing.py`, `paddle_engine.py`, and `extractor.py` are unchanged copies
  of the benchmark sources. No Tesseract/EasyOCR execution or fallback was added.
- `main.py:lifespan` calls `get_engine()` once before accepting requests. One
  dedicated executor thread loads and runs the model. In `paddle_engine.py`,
  `_engine_instance` caches the model; `run()` reuses it. Run **one Uvicorn worker**.
- `extraction.py` executes `extract_fields()` first, maps to the final contract,
  calls Gemini for unresolved values, validates its JSON, then enforces every
  non-null regex value again. Provider failures retain the deterministic output
  and log a warning; unresolved values remain editable. No medicine dictionary or
  answer key is used in extraction.
- Default Gemini model: `gemini-3.1-flash-lite`, verified with the existing key.
  `GEMINI_MODEL` overrides it. The initial `gemini-2.5-flash` returned 404 for this
  account; the final real-image run above completed Gemini normalization successfully.
- Requirements already had PaddleOCR 3.7.0, PaddlePaddle 3.3.1 and both requested
  OpenCV variants at 4.10.0.84. Requirements and the Python environment were not changed.
- Local image storage was explicitly requested instead of roadmap S3/Blob.
  `storage.js` owns save/remove/read-URL operations. The database stores a stable
  `/uploads/prescriptions/<uuid>.jpg` path. Express static middleware serves it
  through an expiring signed URL. Replacing the storage adapter does not require
  a schema or prescription API change.
- PostgreSQL `processing` rows form the local queue. The route responds 202 before
  scheduling OCR. A single Express worker processes them sequentially, resumes
  pending rows after restart, saves `needs_review` or `failed`, and emits
  `scan-complete { scanId, scanStatus }` only to the uploader's authenticated room.
  Run **one Express process** for this local queue implementation.
- The review page loads once, listens for completion, and reloads on socket reconnect.
  There is no status polling loop. A manual refresh handles an unavailable connection.
- Every caregiver read uses `checkPermission('view_only')`; writes require
  `full_access`. Image URLs expire after ten minutes. GET the scan again to renew one.
- The schema's `Decimal(5,2)` stores confidence as approximately `0.99`. The exact
  native score is also stored as `ocrExtractedData.nativeConfidence`, which drives
  the review warning below 0.95. The schema is unchanged.
- A scan has only one `medicationId`. It points to the first confirmed medicine;
  all IDs are preserved in `ocrExtractedData.confirmedMedicationIds`. All created
  medicines share the scan patient and doctor. `confirmedData` retains the reviewed
  fields separately from the original extraction.
- Confirmation requires `reviewed: true`, doctor name, and complete medicines,
  including user-reviewed `trackingType` and `startDate` needed by Prisma. The UI
  offers today's start date and requires an explicit tracking choice. End date is
  optional; duration remains in instructions. No schedules or inventory rows are
  created in Phase 4.

## Start the services (PowerShell)

The existing `.venv` and `.env` files are used directly. No reinstall is needed.

```powershell
Set-Location D:\MediTrack-App
docker compose up -d
```

Terminal 1 — start Python and wait for `Application startup complete`:

```powershell
Set-Location D:\MediTrack-App\ocr-service
$env:OCR_IMAGE_ORIGINS = 'http://127.0.0.1:3000'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

Terminal 2 — start Express (the override handles the old 8000 setting in `.env`):

```powershell
Set-Location D:\MediTrack-App\server
$env:OCR_SERVICE_URL = 'http://127.0.0.1:8001'
$env:PRESCRIPTION_IMAGE_ORIGIN = 'http://127.0.0.1:3000'
node src/index.js
```

Terminal 3 — start React:

```powershell
Set-Location D:\MediTrack-App\client
node node_modules/vite/bin/vite.js --host localhost
```

Open `http://localhost:5173/prescription-scans`. Test account credentials from the
completed verification are in `ocr-service/tests/.env.demo`, which is gitignored.
To generate another isolated test account and reproduce all three fixture runs:

```powershell
Set-Location D:\MediTrack-App\server
node src/routes/prescription-scans/verify-real.mjs
```

This intentionally retains its demo account, scans, doctor and medicines for
Prisma Studio inspection and writes fresh credentials only to `.env.demo`.

## Exact curl → socket → GET → confirm → Prisma Studio flow

In a fourth PowerShell terminal, log into the retained demo account:

```powershell
Set-Location D:\MediTrack-App
$demo = @{}
Get-Content .\ocr-service\tests\.env.demo | ForEach-Object {
  $parts = $_ -split '=', 2
  $demo[$parts[0]] = $parts[1]
}
$api = 'http://127.0.0.1:3000'
$loginBody = @{ email = $demo.DEMO_EMAIL; password = $demo.DEMO_PASSWORD } | ConvertTo-Json
$session = Invoke-RestMethod "$api/api/auth/login" -Method Post -ContentType 'application/json' -Body $loginBody
$env:ACCESS_TOKEN = $session.accessToken
$headers = @{ Authorization = "Bearer $env:ACCESS_TOKEN" }

# Start the Socket.io watcher before uploading, without exposing the token in argv.
$watch = Start-Job -ArgumentList $env:ACCESS_TOKEN -ScriptBlock {
  param($token)
  $env:ACCESS_TOKEN = $token
  Set-Location D:\MediTrack-App\server
  node src/routes/prescription-scans/watch-scan.mjs
}
Start-Sleep 2
Receive-Job $watch
# Expect: Listening for scan-complete. Upload your image now.

$upload = curl.exe --fail-with-body --silent --show-error `
  -H "Authorization: Bearer $env:ACCESS_TOKEN" `
  -F 'image=@D:\MediTrack-App\ocr-service\tests\rx_04.jpg;type=image/jpeg' `
  "$api/api/prescription-scans" | ConvertFrom-Json
$scanId = $upload.scanId
$upload
# HTTP 202: { scanId: <id>, scanStatus: processing }

Receive-Job $watch -Wait
# Expect: scan-complete {"scanId":<id>,"scanStatus":"needs_review"}
# Press Ctrl+C after that line to return to the prompt; the server keeps running.

$scan = Invoke-RestMethod "$api/api/prescription-scans/$scanId" -Headers $headers
$scan.ocrExtractedData | ConvertTo-Json -Depth 12
$scan.ocrRawText
```

Review the actual rx_04 image and those fields before running confirmation. For
this synthetic fixture, tracking is countable for capsule/injection/tablet,
volume_ml for syrup, and weight_grams for ointment:

```powershell
$medicines = @($scan.ocrExtractedData.medicines | ForEach-Object {
  $m = $_ | ConvertTo-Json | ConvertFrom-Json
  $tracking = switch ($m.medicineForm) {
    'syrup' { 'volume_ml' }
    'ointment' { 'weight_grams' }
    default { 'countable' }
  }
  $m | Add-Member -NotePropertyName trackingType -NotePropertyValue $tracking
  $m | Add-Member -NotePropertyName startDate -NotePropertyValue (Get-Date -Format 'yyyy-MM-dd')
  $m
})
$confirmation = @{ reviewed = $true; doctor = $scan.ocrExtractedData.doctor; medicines = $medicines } | ConvertTo-Json -Depth 12
$saved = Invoke-RestMethod "$api/api/prescription-scans/$scanId/confirm" `
  -Method Post -Headers $headers -ContentType 'application/json' -Body $confirmation
$saved.scan | Select-Object id, scanStatus, reviewedAt, doctorId, medicationId
$saved.medications | Select-Object id, medicineName, doctorId, addedVia
Stop-Job $watch
Remove-Job $watch

Set-Location D:\MediTrack-App\server
npm run db:studio
```

In Prisma Studio, open **PrescriptionScan** and filter `id` to `$scanId`: expect
`completed`, a non-null `reviewedAt`, `doctorId`, and first `medicationId`. Open
**Doctor** at `$saved.doctor.id`: expect Arjun Mehta and `source=ocr_scan`. Open
**Medication** and filter `patientId` to `$session.user.id`, then check the five
IDs printed above: `addedVia=ocr_scan`, matching doctor ID, and the reviewed values.
The earlier verified rows are patient 101 / scan 5 / doctor 2 / medications 32–36.

## Repeatable checks

```powershell
Set-Location D:\MediTrack-App\ocr-service
.\.venv\Scripts\python.exe -m unittest discover -s tests -p test_reference.py
Set-Location D:\MediTrack-App\server
node src/routes/prescription-scans/verify-real.mjs
node --test src/routes/dashboard/dashboard.integration.test.js
Set-Location D:\MediTrack-App\client
node src/pages/prescription-scans/verify-ui.mjs
npm test
npm run build
```

The browser check uses installed Chrome and the real backend, uploads rx_04,
checks all five medicine forms, verifies confirmation is initially disabled,
checks 1440 px and 390 px layouts, edits an instruction, and confirms the scan.

## Files created or changed in this implementation

Modified:

- `ocr-service/main.py`
- `server/src/app.js` (route/static mounts only; existing Swagger edits retained)
- `server/src/index.js` (Socket.io/queue lifecycle)
- `client/package.json`
- `client/package-lock.json` (Socket.io client dependency)
- `client/src/App.jsx`
- `client/src/components/layout/AppShell.jsx`

Created:

- `ocr-service/README.md`
- `ocr-service/preprocessing.py`
- `ocr-service/paddle_engine.py`
- `ocr-service/extractor.py`
- `ocr-service/extraction.py`
- `ocr-service/tests/test_reference.py`
- `server/src/routes/prescription-scans/index.js`
- `server/src/routes/prescription-scans/storage.js`
- `server/src/routes/prescription-scans/validation.js`
- `server/src/routes/prescription-scans/runtime.js`
- `server/src/routes/prescription-scans/verify-real.mjs`
- `server/src/routes/prescription-scans/watch-scan.mjs`
- `server/uploads/prescriptions/.gitignore`
- `client/src/pages/prescription-scans/PrescriptionScans.jsx`
- `client/src/pages/prescription-scans/PrescriptionScans.module.css`
- `client/src/pages/prescription-scans/verify-ui.mjs`

Verification artifacts created:

- `ocr-service/tests/results/rx_01.json`
- `ocr-service/tests/results/rx_04.json`
- `ocr-service/tests/results/rx_08.json`
- `ocr-service/tests/results/verification.json`
- `ocr-service/tests/results/ui-verification.json`
- `ocr-service/tests/results/curl-verification.json`
- `ocr-service/tests/results/review-desktop.png`
- `ocr-service/tests/results/review-mobile.png`
- `ocr-service/tests/.env.demo` (ignored generated demo credentials)
- Nine uploaded JPEG copies under `server/uploads/prescriptions/` (ignored runtime data):
  - `0958876d-9f18-4310-9b23-93a1c5607356.jpg`
  - `2a350309-512c-4f0e-87b5-75d2c953bf08.jpg`
  - `6159379e-f4eb-4c5c-85e8-0551eef4518c.jpg`
  - `6e63c2a4-b67d-401e-aa0d-71378132df34.jpg`
  - `a80c4a85-afa6-42c4-add4-0b1da55e29c8.jpg`
  - `a824c95c-636c-40aa-88cd-bca2de926ece.jpg`
  - `eba57ec8-c590-410c-82f3-6ed1acee0d5e.jpg`
  - `f4481681-3dd9-41e1-807c-41732a11381e.jpg`
  - `ffdab4ac-0f0c-43c0-8148-b28c2cf64cbc.jpg`

Existing test JPEGs, `requirements.txt`, all existing `.env` files, canonical and
server schemas, and reference docs were not changed. Existing unrelated edits to
server packages, Swagger docs, and earlier routes were preserved. Generated
`node_modules`, `dist`, and Python bytecode are excluded from this source manifest.
