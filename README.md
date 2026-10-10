# MediTrack — Phase 0

Local architecture: React/Vite client (`5173`) -> Express server (`3000`) ->
FastAPI OCR service (`8001`). PostgreSQL (`5432`) and Redis (`6379`) run in Docker.
The client is intentionally blank. Only the two health routes are implemented;
auth, OCR execution, business logic, sockets and UI pages belong to later phases.

## Prerequisites and initial setup

Use Node.js 22.12+ (Node 22 recommended), npm, Python 3.11, and Docker Desktop
running Linux containers. The commands below use PowerShell from this checkout.

Docker Desktop on this machine is installed per-user. If `docker` is not on PATH,
run this in each PowerShell terminal that uses Docker:

```powershell
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
```

Local `.env` files have already been prepared in this checkout and are ignored by
Git. On a fresh clone only, copy the examples, choose a local PostgreSQL password,
and use that same password in the root `.env` and `server/.env`:

```powershell
Set-Location D:\MediTrack-App
Copy-Item .env.example .env
Copy-Item server/.env.example server/.env
Copy-Item ocr-service/.env.example ocr-service/.env
```

Never put secrets in the client. No API keys are needed for Phase 0. PostgreSQL
and Redis bind only to loopback; Docker volumes preserve their data across stops.
Changing the PostgreSQL password in `.env` after the volume has been initialized
does not change the database user's password.

Install dependencies on a fresh clone:

```powershell
Set-Location D:\MediTrack-App\client
npm ci
Set-Location D:\MediTrack-App\server
npm ci
Set-Location D:\MediTrack-App\ocr-service
py -3.11 -m venv .venv
# Keep large OCR dependency downloads on D: (C: is nearly full on this machine).
New-Item -ItemType Directory -Force .cache/tmp, .cache/pip | Out-Null
$env:TEMP = (Resolve-Path .cache/tmp).Path
$env:TMP = $env:TEMP
$env:PIP_CACHE_DIR = (Resolve-Path .cache/pip).Path
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
```

Prisma CLI and Client use the same pinned 6.x version so `docs/schema.prisma`
can be copied without changing its datasource or generator. A patched
`deepmerge-ts` override in Prisma's configuration tooling addresses
GHSA-ggr8-5vv4-36mx. The roadmap's OCR
setup packages are installed, but no engines are imported or models downloaded
by the health service. PaddleOCR remains the sole selected engine for Phase 4;
there is no engine selection or fallback implementation.

## Start locally

Start the database and Redis, apply migrations, and generate the Prisma client.
On Windows, stop Express and Prisma Studio before migration/generation commands
so they do not hold the generated Prisma engine DLL open:

```powershell
Set-Location D:\MediTrack-App
docker compose up -d --wait
docker compose ps
Set-Location server
npx prisma migrate dev --name init
npx prisma generate
```

The migration command is safe to repeat: an already applied migration is not
applied again. Run each service in its own terminal:

```powershell
# Terminal 1 — Express
Set-Location D:\MediTrack-App\server
npm run dev
```

```powershell
# Terminal 2 — FastAPI (activation is not necessary)
Set-Location D:\MediTrack-App\ocr-service
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001 --reload --env-file .env
```

```powershell
# Terminal 3 — React/Vite, blank until UI phases
Set-Location D:\MediTrack-App\client
npm run dev
```

Use `npm start` in `server/` to run without watch mode. Express connects the shared
Prisma and Redis clients before listening, and closes connections on shutdown.
Its health route returns HTTP 503 if PostgreSQL or Redis cannot be reached.

## Verify the Phase 0 deliverable

The roadmap, page 10, states:

> Deliverable: All 20 tables exist in PostgreSQL (verified via npx prisma studio); all three services run locally and can reach each other.

With all three services running:

```powershell
curl.exe -i http://127.0.0.1:3000/api/health
curl.exe -i http://127.0.0.1:8001/health
# Verify the client dev server can proxy to Express:
curl.exe -i http://localhost:5173/api/health
# Verify the frontend shell is served (intentionally blank):
curl.exe -I http://localhost:5173

Set-Location D:\MediTrack-App\server
npm run check:setup
npx prisma migrate status
npx prisma studio
```

The three health requests must return HTTP 200 with `{"status":"ok"}`. The shell
must return HTTP 200. `check:setup` uses the shared Prisma client to compare the
actual PostgreSQL table names to all 20 models, verifies Google-auth columns and
the `AuthProvider` enum, pings Redis, then calls FastAPI from the Node backend.
It exits nonzero if any check fails. It writes no application data.

Open the Studio URL printed by the CLI (normally `http://localhost:5555`). Check
that the model picker contains all 20 models below and open each to confirm that
its table loads. Empty tables are expected; no seed data is created in Phase 0.
Open `User` and confirm `authProvider`, `googleId`, and nullable `passwordHash`
are present. `check:setup` verifies their actual database definitions.

| Studio model | PostgreSQL table |
| --- | --- |
| User | users |
| CaregiverPatientLink | caregiver_patient_links |
| Invitation | invitations |
| Doctor | doctors |
| Medication | medications |
| PrescriptionScan | prescription_scans |
| MedicationSchedule | medication_schedules |
| DoseLog | dose_logs |
| MedicineInventory | medicine_inventory |
| Notification | notifications |
| EscalationAlert | escalation_alerts |
| AdherenceStat | adherence_stats |
| WeeklySummaryReport | weekly_summary_reports |
| AiChatConversation | ai_chat_conversations |
| AiChatMessage | ai_chat_messages |
| AiInsight | ai_insights |
| DrugInteraction | drug_interactions |
| MedicationInteractionFlag | medication_interaction_flags |
| UserPreference | user_preferences |
| AuditLog | audit_logs |

PostgreSQL also contains Prisma's `_prisma_migrations` bookkeeping table. That
table is not one of the 20 application tables and is not a Studio model.

To check the client build or Python installation:

```powershell
Set-Location D:\MediTrack-App\client
npm run build
Set-Location D:\MediTrack-App\ocr-service
.\.venv\Scripts\python.exe -m pip check
```

Stop foreground services with Ctrl+C. Stop containers without deleting data:

```powershell
Set-Location D:\MediTrack-App
docker compose down
```

`docs/` is reference-only and was not modified. The original file named
`gitignore` is preserved; the new `.gitignore` is the active Git ignore file.
Package lockfiles, the canonical schema copy and migrations belong in Git;
`.env`, `node_modules`, Python `.venv`, caches and build output do not.
