# MediTrack — Complete Running & Testing Guide

**Covers:** every feature built in Phases 0–11 (plus the fixes pass and UI batch 4) · **Written for:** someone who knows nothing about the project · **Machine:** Windows, PowerShell, project at `D:\MediTrack-App`

> **How to use this guide.** Read Part 0 once. Do Parts 1–3 once to get everything running. Then work through Part 4 one test at a time. Every test has the same four blocks: **What it is**, **Steps**, **You should see**, **If it is wrong**. Tick the box when it passes. Part 5 lists the automated tests (one command each). Part 7 is a troubleshooting table. Part 8 is a one-page cheat sheet.
>
> **Honesty note.** I wrote this from your project documents and the test evidence you pasted, not by running your app. Where a button or menu name could differ slightly in your build, I say "look for something like…". Where I am unsure how a script behaves, I mark it **⚠ Unverified** and give you a fallback. Menu names in your app are the source of truth — if a name differs by a word, that's fine.

---

## Table of contents

- Part 0 — Ten ideas you need before you start
- Part 1 — One-time setup checklist
- Part 2 — Start every service (and how to stop / restart)
- Part 3 — Test accounts and browser windows
- Part 4 — Feature tests (T1 … T27)
- Part 5 — Automated tests (one command each, with expected counts)
- Part 6 — Inspecting the database (Prisma Studio)
- Part 7 — Troubleshooting table
- Part 8 — Cheat sheet and final pass/fail checklist

---

# Part 0 — Ten ideas you need before you start

1. **MediTrack has six moving parts.** (1) PostgreSQL database, (2) Redis, (3) Mailpit fake inbox — these three run in Docker. Then (4) the Python OCR service, (5) the Node/Express backend, (6) the React website. If any one is off, some features fail in a predictable way (Part 7 tells you which).
2. **Ports are doors.** Each program listens on a numbered "door" on your own computer: Postgres 5432, Redis 6379, OCR **8001 in your commands** (design default 8000 — see note in Part 2), backend **3000**, website **5173**, Mailpit inbox website **8025**, Mailpit mail-receiving door **11025**.
3. **Terminal = PowerShell window.** You will keep **several open at once**, one per long-running program. Leave them running. A program that "never finishes" is a program that is *running* — that is correct.
4. **There is no fixed "role" for a person.** Everyone has the same kind of account. You are a *patient* for your own data and a *caregiver* for someone else's data only when a **relationship (link)** between you two exists. Test accounts are therefore just "accounts"; the *link* decides who can see what.
5. **Three permission levels on a link:** `full_access`, `view_only`, `alerts_only`. They are **not** a ladder. `full_access` = everything. `view_only` = can read medications, doses, adherence, weekly reports and insights, but can't change anything and gets no live alerts. `alerts_only` = gets live missed-dose alerts and refill warnings, but can't read doses/adherence/reports/insights. Invitations always start as `view_only`; only the **patient** can change it later.
6. **Email is fake locally.** The backend "sends" email to **Mailpit**, which just shows it on a web page: `http://localhost:8025`. You will open it for account verification, password reset, invitations and weekly reports.
7. **Gemini** (Google's AI) is used for: schedule generation, the weekly report text, the weekly insight, AI chat, and OCR clean-up. You need `GEMINI_API_KEY` in `server\.env` (and `ocr-service\.env`) for those. Without it those features show an error; everything else still works.
8. **Time-based jobs.** Some things happen "on a timer" (creating today's dose rows, escalations, refill checks, weekly reports). For testing you will run those jobs **by hand** with a command so you don't have to wait. The commands are in the tests.
9. **Sessions.** Your login lasts 15 minutes at a time and renews itself silently using a 7-day token kept in that browser *tab* (not shared between tabs). **Only one active session per account exists**: logging in to the same account somewhere else (including by a script) replaces the other session; the old tab will get "session ended" within ~15 minutes and you simply log in again.
10. **Use one address style everywhere.** Pick `http://127.0.0.1:5173` **or** `http://localhost:5173` and stick to it. They are different "origins" to a browser, so sessions don't carry across, and Google Sign-In only works for the exact origin registered in Google Cloud. Emailed links use whatever is in `CLIENT_ORIGIN` in `server\.env`; if links open the "other" style, just log in again there.

---

# Part 1 — One-time setup checklist

Do this once. If your project already runs (it does — you finished Phase 11), skim and tick.

## 1.1 Software that must be installed

| Item | Check with | Expect |
|---|---|---|
| Docker Desktop (running) | `docker --version` | a version number. If "not recognized", run `$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"` in that terminal first |
| Node.js | `node --version` | a version number (18+) |
| Python venv for OCR | `D:\MediTrack-App\ocr-service\.venv\Scripts\python.exe --version` | a version number |
| Git | `git --version` | a version number |
| Google Chrome | open it | needed for Playwright tests and Google Sign-In |

## 1.2 Files holding secrets (never commit these)

| File | Must contain (names only — values are yours) |
|---|---|
| `server\.env` | `DATABASE_URL`, `REDIS_URL`, `PORT=3000`, JWT secrets (access + refresh), `GEMINI_API_KEY`, `GOOGLE_CLIENT_ID`, `CLIENT_ORIGIN`, `SMTP_HOST`, `SMTP_PORT=11025`, `SMTP_SECURE`, `MAIL_FROM`, optional `SUPPORT_INBOX`, optional `OCR_SERVICE_URL`, optional `OCR_REQUEST_TIMEOUT_MS`, optional `ESCALATION_GRACE_PERIOD_MINUTES` |
| `ocr-service\.env` | `GEMINI_API_KEY` |
| `client\.env` | the Google client id used by the Google button (`VITE_…`) |

> Why SMTP port 11025 and not 1025: Windows would not let anything bind to 1025 on your machine, so Mailpit's receiving door was mapped to **11025**. This is a local quirk, not a design choice.

## 1.3 Database tables and the interaction data (first-time machine only)

```powershell
Set-Location D:\MediTrack-App\server
npx prisma migrate deploy
npx prisma db seed
```

- `migrate deploy` creates/updates all tables (20 original models + later additive fields such as `Notification.relatedPatientId` and the `AuditLog` fields).
- `db seed` inserts the **30 reviewed drug-interaction pairs**. Running it again is safe: it inserts nothing new (reports already present). If it ever says "Existing interaction requires manual review", someone edited a seeded row by hand — that's the seed protecting reviewed data; do not force it.
- **Never run `prisma migrate reset`** — it wipes the database. It is forbidden in this project.

## 1.4 Install dependencies (first-time machine only)

```powershell
Set-Location D:\MediTrack-App\server ; npm install
Set-Location D:\MediTrack-App\client ; npm install
```

---

# Part 2 — Start every service

You need **1 Docker command + 3 long-running terminals** (OCR, backend, website). Open each in a fresh PowerShell window.

## 2.1 Terminal A — Docker containers (Postgres, Redis, Mailpit)

```powershell
Set-Location D:\MediTrack-App
$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"
docker compose up -d --wait
docker start meditrack-mailpit
docker ps
```

- `up -d --wait` = start in the background and don't return until healthy.
- `docker ps` must list three containers as **Up**: `meditrack-postgres`, `meditrack-redis`, `meditrack-mailpit`.
- First time ever only, if `docker start meditrack-mailpit` says it doesn't exist:
  ```powershell
  docker run -d --name meditrack-mailpit -p 127.0.0.1:11025:1025 -p 127.0.0.1:8025:8025 axllent/mailpit
  ```
- You can close this terminal afterwards; containers keep running.

## 2.2 Terminal B — OCR service (Python)

```powershell
Set-Location D:\MediTrack-App\ocr-service
$env:OCR_IMAGE_ORIGINS = 'http://127.0.0.1:3000'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001
```

**Wait for this exact line** (takes several seconds — it is loading the AI model into memory once):

```
INFO:     Application startup complete.
```

- **Never add `--workers 2`** (or any worker flag). The model is loaded once per process; extra workers would each load their own copy and break the design.
- *About 8000 vs 8001:* the original design diagram used 8000; your Phase 4 guide used 8001 with an override. Whatever port you pick here **must match** what the backend is told in Terminal C (`OCR_SERVICE_URL`). The commands in this guide use 8001 on both sides, so they always match.

## 2.3 Terminal C — Backend (Node/Express)

```powershell
Set-Location D:\MediTrack-App
$env:OCR_SERVICE_URL = 'http://127.0.0.1:8001'
$env:PRESCRIPTION_IMAGE_ORIGIN = 'http://127.0.0.1:3000'
npm --prefix server run dev
```

- `run dev` = `node --watch src/index.js`: it restarts itself when server files change.
- Run **exactly one** backend. The prescription-scan queue and a few in-memory locks live inside this one process.
- When it starts, the dose-log job immediately fills in **today's** missing dose rows (the "catch-up" fix), and again every minute.
- *Optional for audit-log testing (T23):* to see caregiver reads recorded more often than once per 10 minutes, start the backend with a short throttle: `$env:CAREGIVER_READ_THROTTLE_MS = '1000'` **before** the `npm --prefix server run dev` line. Don't leave that set permanently.

## 2.4 Terminal D — Website (React/Vite)

```powershell
Set-Location D:\MediTrack-App
npm --prefix client run dev
```

Wait for `Local: http://localhost:5173/` (or `127.0.0.1:5173`). Vite also forwards anything starting with `/api` to the backend, so the browser never talks to port 3000 directly.

## 2.5 Check that all six parts are alive

```powershell
curl.exe http://127.0.0.1:3000/api/health
curl.exe http://127.0.0.1:8001/health
curl.exe http://127.0.0.1:5173/api/health
```

- All three return a JSON object containing `"status":"ok"` (HTTP 200).
- The first one **checks Postgres and Redis** too — if either is down it returns **HTTP 503** instead of lying that all is well.
- Open `http://localhost:8025` — the Mailpit inbox page should load.

## 2.6 Stopping and restarting

| Want to… | Do this |
|---|---|
| Stop OCR / backend / website | click its terminal, press `Ctrl + C` |
| Restart the backend | `Ctrl + C`, then re-run the Terminal C lines |
| Stop the databases | `docker compose stop` (data is kept) |
| Start them again | `docker compose up -d --wait` then `docker start meditrack-mailpit` |
| **Wipe everything (destroys data)** | **Don't.** Never `migrate reset`, never `docker compose down -v` unless you truly want an empty database |

**Start order matters:** Docker first → OCR (wait for "startup complete") → backend → website.

---

# Part 3 — Test accounts and browser windows

## 3.1 The four accounts

Create these through the website (T1). If you already created them in an earlier run, **reuse them** or change the number (`meditrack.caregiver2@…`) for a clean start.

| Who | Full name | Email | Password | Link permission (we will set) |
|---|---|---|---|---|
| Caregiver | Demo Caregiver | `meditrack.caregiver1@example.com` | `Caregiver#2026` | — |
| Patient One | Demo Patient One | `meditrack.patient1@example.com` | `PatientOne#2026` | **full_access** |
| Patient Two | Demo Patient Two | `meditrack.patient2@example.com` | `PatientTwo#2026` | **view_only** |
| Patient Three | Demo Patient Three | `meditrack.patient3@example.com` | `PatientThree#2026` | **alerts_only** |

Password rule: 8–72 bytes (72 is a hard bcrypt limit). The phone field is optional — leave it blank.

## 3.2 Four isolated windows

Open **four separate windows** so you can be four people at once:

| Window | Browser | Signed in as |
|---|---|---|
| W1 | Chrome normal | Caregiver |
| W2 | Chrome Incognito | Patient One |
| W3 | Edge or Firefox | Patient Two |
| W4 | A second Incognito window / another browser | Patient Three |

Tabs inside one window can also hold different accounts (each tab keeps its own session), but a **link opened in a brand-new tab starts logged out** — that's normal and is why you sometimes see "Sign in to accept".

## 3.3 The three test prescription images

Saved earlier in `scratchpad\prescriptions\` (computer-printed fake prescriptions; copy them to your Desktop):

| File | Doctor | Medicines | Purpose |
|---|---|---|---|
| `prescription_patient_one.png` | Dr. Arjun Mehta | Metformin 500 mg, Atorvastatin 10 mg | clean baseline, no interaction |
| `prescription_patient_two.png` | Dr. Neha Kapoor | Simvastatin 20 mg + Clarithromycin 500 mg | **a seeded dangerous pair** → triggers the interaction warning |
| `prescription_patient_three.png` | Dr. Rajesh Verma | Amoxicillin 500 mg, three times daily | tight schedule for adherence/alert tests |

## 3.4 A PowerShell helper you'll reuse: "get an access token"

Several tests use scripts that need a login token. Put this in any terminal (call it **Terminal E**), changing the email/password for whoever you need:

```powershell
$api = 'http://127.0.0.1:3000'
$body = @{ email = 'meditrack.patient1@example.com'; password = 'PatientOne#2026' } | ConvertTo-Json
$s = Invoke-RestMethod "$api/api/auth/login" -Method Post -ContentType 'application/json' -Body $body
$env:ACCESS_TOKEN = $s.accessToken
$headers = @{ Authorization = "Bearer $env:ACCESS_TOKEN" }
"token length: " + $env:ACCESS_TOKEN.Length
```

⚠ Logging in this way **replaces that account's browser session** (one active session per account). Afterwards that browser may ask you to log in again within ~15 minutes. That's expected, not a bug. Access tokens live 15 minutes — re-run the snippet when a command says `401`.

Finding a person's numeric `id` (needed for some job commands): after login, `$s.user.id`, or open Prisma Studio → **User** table (Part 6).

---

# Part 4 — Feature tests

Legend: ☐ = tick when it passes · **W1–W4** = the four windows from Part 3 · **Terminal E** = your spare PowerShell for token/job commands · every "You should see" is the pass condition.

Recommended order: T1 → T2 → … in sequence, because later tests reuse the accounts, links, medicines and doses made by earlier ones.

---

## T1 — Create an account and verify the email  ☐

**What it is.** Sign-up creates the account; a verification email (with a one-time link) proves you own the address. The link contains a random token; only a *hash* of it is stored (in Redis, 24 hours). Verification is required before you can log in.

**Steps** (repeat for all four accounts, one per window)
1. Open `http://127.0.0.1:5173/` (landing page). Click **Sign up**.
2. Fill **Full name**, **Email**, **Password** from Part 3.1. Leave phone blank. Click **Create account**.
3. You should now see a **"check your email"** message.
4. Open `http://localhost:8025` (Mailpit). The newest message is addressed to the email you used. Open it.
5. Click the **verification link** in it. It opens `…/verify-email/<token>`.
6. The page should say your email is verified, with a **Continue** button.

**You should see.** Verified screen; afterwards you can log in. Re-clicking the same email link a second time should say the link is invalid/used (single-use).

**Also try (validation).**
- Sign up again with the **same email** → "already registered"-style error.
- Password shorter than 8 characters → live guidance/error.
- Password over 72 bytes → blocked with the byte-limit help text.
- Try to log in **before** verifying (use a fresh extra email) → refused with an "verify your email" style message.

**If it is wrong.** No email in Mailpit → Docker mailpit container not running (`docker ps`) or `SMTP_PORT` in `server\.env` isn't `11025`; restart the backend after changing `.env`. Link opens a blank/wrong site → `CLIENT_ORIGIN` in `server\.env` doesn't match the address you browse.

---

## T2 — Log in, stay logged in, log out  ☐

**What it is.** Login checks the bcrypt-hashed password and issues two JWTs: a 15-minute **access token** (kept in the page's memory) and a 7-day **refresh token** (kept in `sessionStorage`; its SHA-256 digest is stored in Redis under `auth:refresh:<userId>`). Each time the refresh token is used it is **rotated** (old one dies). Logout deletes the Redis entry.

**Steps**
1. In W1 open `/login`. Enter the caregiver email and password. Click **Log in**.
2. You should land on **/dashboard**.
3. Press **F5** (reload). You should *stay* logged in (the refresh token silently got a new access token).
4. Open a **new tab** to the same site. You should be logged out there (sessions are per tab). Close that tab.
5. Use the account/menu control to **Log out**. You should return to the landing/login page.
6. Press the browser **Back** button → protected pages must not show data; you are sent to login.

**Wrong-credential checks.** Wrong password → generic "invalid email or password" (same message for unknown email, so attackers can't tell which emails exist). Google-only account using the password form → a hint to use Google.

**If it is wrong.** Logged out after every reload → Redis not running; `curl.exe http://127.0.0.1:3000/api/health` will show 503.

---

## T3 — Forgot password and reset  ☐

**What it is.** You request a reset; the server emails a link with a 15-minute single-use token. The response is *identical* whether the email exists or not (so the form can't be used to discover who has accounts). Google-only accounts get the same generic response and no email.

**Steps**
1. Log out. Open `/forgot-password`. Enter `meditrack.patient3@example.com`. Submit → generic success text.
2. Mailpit: open the "reset your password" email. Click its link (`…/reset-password?token=…`).
3. Enter a new password twice (e.g. `PatientThree#2027`). Submit → success.
4. Log in with the **old** password → rejected. Log in with the **new** → works.
5. Open the same reset link again → "expired/used" screen with a **request a new link** option.
6. Go back to **/forgot-password** with an email that doesn't exist (`nobody@example.com`) → *the same* success text, and **no** email arrives in Mailpit.

**Afterwards:** reset Patient Three's password back to `PatientThree#2026` the same way, or just remember the new one and update your notes.

---

## T4 — Sign in with Google (optional; needs Google setup)  ☐

**What it is.** Google gives the browser a signed ID token; the backend verifies it with Google's library (signature, expiry, audience = your client id), then picks one of three branches: (a) known Google id → log in; (b) no Google id but a local account has this email → **link** to that account (no duplicate); (c) nothing found → create a Google-only account (`passwordHash` null, email auto-verified). All three end with the **same JWT pair** as password login.

**Prerequisites.** `GOOGLE_CLIENT_ID` in `server\.env`, the matching client id in `client\.env`, and the exact website origin (e.g. `http://localhost:5173`) listed under *Authorized JavaScript origins* in Google Cloud. Use real Chrome/Edge — an embedded/IDE browser may not show Google's popup.

**Steps**
1. Open `/login` and click the Google button; choose a Google account.
2. You land on the dashboard. Open **Prisma Studio → User**: one row for that email with `authProvider = google`, `emailVerified = true`, `passwordHash = null`.
3. **Branch (b) check:** sign up normally with another Gmail you own (password), verify, log out; now use Google with the same Gmail. In Prisma Studio there must still be **exactly one** row for that email, now with `googleId` filled and the password hash still present.
4. Open **/settings** as the Google-only account: the password-reset control is hidden (nothing to reset).

**If it is wrong.** Popup says origin not allowed → add your exact origin in Google Cloud. 401 after the popup → `GOOGLE_CLIENT_ID` on the server doesn't match the client id.

---

## T5 — Profile, settings and preferences  ☐

**What it is.** View/edit your own profile; account settings; preferences (notification channel, language, theme, timezone). Preferences are stored per user and saved immediately.

**Steps**
1. **Profile:** open **Profile**. Check name, email, sign-in method; optional fields say "Not provided".
2. **Edit profile:** click **Edit profile**; change the full name and address; the **Save** button is disabled until something changes. Save → toast "Profile updated". Edit again, change a field, click **Cancel** → a "discard changes?" dialog appears (focus returns where it was after you close it).
3. **Settings** (`/settings`): shows email + verified status. Password users see a *send password reset link* control; Google-only users do not. There is deliberately **no** delete-account or change-password form.
4. **Notification preferences** (`/settings/notifications`): switch **Theme** to dark → it changes instantly and is saved. Reload → dark persists. Set a **Timezone** (e.g. Asia/Kolkata). Save → "Preferences saved".
5. Notice the channel choices are only **In the app** and **Email** (see T22).

**Why timezone matters.** "Today", dose times, the heatmap and reports are all computed in the *patient's* timezone (preference → profile → UTC fallback, DST-aware).

---

## T6 — Relationships: invite, accept, permissions, revoke  ☐

**What it is.** A **link** (`CaregiverPatientLink`) joins two people. A patient invites a caregiver by email; the invitation token only ever travels inside the email (7-day expiry). Accepting creates the link as `view_only`. Only the **patient** side can change the level or revoke.

**6.1 Send three invitations** (in each patient's window: W2, W3, W4)
1. Open **Relationships → Invite** (`/relationships/invite`).
2. **Invitee email:** `meditrack.caregiver1@example.com`.
3. **Relationship type:** type a label (e.g. *Caregiver* / *Daughter*) — the chips are quick-fill only.
4. **Invite them as your:** **Caregiver**.
5. Submit. A banner reminds you: *new relationships start with view-only access*. (There is no "copy link" — the link exists only in the email.)
6. Try inviting **your own email** → field error.

**6.2 Accept (in W1, the caregiver)**
1. Mailpit shows three "MediTrack relationship invitation" emails to the caregiver. Open the first; click its link `…/invitations/<token>`.
2. The page shows who invited you and says accepting gives **view-only** access. If it says **Sign in to accept**, log in as the caregiver, then you return to the same page.
3. Click **Accept invitation**. You land on **Relationships** with a toast and the patient appears under **People I care for** as *Active · View only*.
4. Repeat for the other two emails.
5. *Cold-start path (optional):* invite an email that has **no account**. Opening the link while logged out sends you to **sign-up** with the invitation preserved; after you register and verify, accepting works. If the email already has an account, you are sent to **login** instead.
6. *Decline path (optional):* have Patient One invite a spare email, then use **Decline invitation**; the link is never created.

**6.3 Set the three permission levels (patient side)**
- **W2 / Patient One:** Relationships → the caregiver row → change permission to **Full access** → confirm.
- **W3 / Patient Two:** leave as **View only**.
- **W4 / Patient Three:** change to **Alerts only**.
- In W1, **Patients** should now list three cards with labels *Full access*, *View only*, *Alerts only*.

**6.4 Rules that must hold**
- In W1 (caregiver) there is **no** control to change a permission level or revoke on a "People I care for" row (only patient rows expose management).
- Changing permission takes effect **immediately** — no re-login (checked from the database on every request).

**6.5 Both directions at once (optional, proves "no fixed role")**
In W3, invite `meditrack.patient1@example.com` **as a caregiver** (Patient Two will care for Patient One). Patient One accepts via Mailpit. Now Patient Two has **both** a "People I care for" entry (Patient One) and an "People who care for me" entry (Caregiver). Same person, two roles, depending on the link row.

**6.6 Downgrade/restore and revoke**
1. W4: set Patient Three to **View only**, then back to **Alerts only**. (Used again in T21: this hides/restores notifications.)
2. Finally, to test revoke, make a *throw-away* link (spare invite) and **Revoke** it → a nested confirmation dialog → the caregiver immediately loses access (their next request to that patient returns 403 and the patient disappears from their list). *Don't revoke the three main links — you need them below.*

**If it is wrong.** Invitation email missing → T1 "if it is wrong". "Sign in to accept" loop → you opened the link in a tab where you're not logged in as the invited email.

---

## T7 — Doctors  ☐

**What it is.** A patient's list of doctors (name, specialization, clinic, phone, address). Created by hand or automatically from a scan (T8). Deleting a doctor does **not** delete the medicines they prescribed: the medicine's doctor reference is just cleared.

**Steps** (W2 as Patient One)
1. Open **Doctors**. Click **Add doctor**; fill name *Dr. Test Hand*, specialization, clinic. Save → appears in the list.
2. Open it, **Edit** a field, save.
3. **Delete** it → confirm → gone.
4. (Caregiver check) In W1 open a doctor list for Patient One (full_access): visible. For Patient Three (alerts_only): **restricted / 403**.

---

## T8 — Scan a prescription (OCR)  ☐

**What it is.** The pipeline: upload → server saves the image and replies at once ("processing") → a background worker sends a signed 10-minute image URL to the Python OCR service → OCR (PaddleOCR) reads text → regex extracts fields → Gemini fills only what regex missed → status becomes **needs_review** → a live `scan-complete` event reaches your browser → **you must review and confirm** → confirmation creates a Doctor and Medication rows. Nothing is ever auto-accepted.

**Steps** (each patient in their own window)
1. Make sure Terminal B shows "Application startup complete".
2. Open **Scan** (route `/prescription-scans`) → choose `prescription_patient_one.png` (W2).
3. The page confirms the upload **immediately** and shows *processing* — it must not freeze.
4. After roughly 8–15 seconds (the first scan after starting OCR can be slower; the server waits up to 240 s) the page updates **by itself** to a review form: doctor, clinic, and the medicines (name, form, strength, frequency, duration).
5. Compare with the image. Edit a field to prove the form is editable. Each medicine needs a **tracking type** and a **start date** (the tracking type auto-fills from the form: tablet/capsule → countable, syrup → volume, ointment → weight; you may override).
6. The **Confirm** button stays disabled until you acknowledge that you reviewed the data. Confirm.
7. Scan status becomes **completed**. Check **Doctors** (Dr. Arjun Mehta) and **Medications** (Metformin, Atorvastatin).
8. Repeat: Patient Two (W3) with `prescription_patient_two.png`; Patient Three (W4) with `prescription_patient_three.png`.

**Important correction to older guides.** Confirming a scan creates **only** doctor + medication rows. It does **not** create schedules or inventory — you add those in T10 and T11.

**Negative checks**
- Upload a `.txt` or a non-image → rejected with a clear message.
- Open another patient's scan id in the URL as the wrong user → 404/403 (scans are per patient and permission-checked).
- Stop the OCR service, upload, and watch the scan fail gracefully (status shows an error, not a spinner forever); restart OCR and re-upload.

**If it is wrong.** Stuck on *processing* forever → OCR service not running/not on the port the backend expects (Part 2.2/2.3). "Fetch image failed" in the OCR window → `OCR_IMAGE_ORIGINS` not set to `http://127.0.0.1:3000`.

---

## T9 — Manual medicines (no scan)  ☐

**What it is.** The second way a medicine gets in: for OTC drugs, supplements or lost paper. Same data model and the same security checks as the OCR path. `addedVia` records `ocr` vs `manual` and can never be edited afterwards.

**Steps** (W2)
1. **Medications → Add medication.**
2. Pick **Medicine form = syrup**. Watch **Tracking type** auto-select *volume (ml)*. Change form to *tablet* → it resets to *countable*. Override the tracking type manually, then edit an *unrelated* field → your override survives; change the *form* again → it resets (by design).
3. Fill name *Paracetamol*, dose 500 mg, frequency *twice daily after meals*, start date today. Save.
4. Open the medicine's **detail** page. Edit instructions and save.
5. **Discontinue** (the delete action). The medicine is *not erased*: it becomes `discontinued` and stays in history; it disappears from "active" lists.
6. (Permission check) W3 view_only caregiver can *see* Patient Two's list but has no add/edit/delete buttons.

---

## T10 — Schedules (reminder times)  ☐

**What it is.** A schedule says *when* (time of day), *which days* (Mon–Sun) and *how many units* (`doseAmount`) a medicine is taken. Three ways: manual, **Generate with AI** from the frequency text (Gemini; saved immediately; a second Generate returns 409 so you can't double up), and **taper** (different doses on date ranges).

> Don't confuse **strength** (`dosageAmount` — "500 mg per tablet") with **doseAmount** (how many *units* you take at a time — usually 1). Mixing them would corrupt inventory maths.

**Steps** (W2, Metformin)
1. Open the medicine → **Schedule** section.
2. **Manual:** add 08:00 every day, dose 1; add 20:00 on weekdays only. Save.
3. **Generate with AI:** on a medicine with no schedule (e.g. Paracetamol, "twice daily after meals") click **Generate schedule**. Times like 09:00 / 21:00 appear, validated and saved; edit one time to prove it's editable.
4. Click **Generate** again → refused (conflict message) — existing schedules must be edited/deactivated first.
5. **Taper:** create a taper with two steps (e.g. 2 units for 3 days then 1 unit for 3 days). On a date outside every step, that schedule contributes nothing.
6. **Deactivate** one schedule; it stops generating doses.
7. Patient Three (W4): schedule Amoxicillin **three times a day**, setting one time **a few minutes from now** — used in T12.

**Within about a minute** the server's catch-up job creates today's dose rows for any schedule time not yet in the database (idempotent per schedule + time; today only; never for inactive/discontinued medicines or days outside the schedule).

---

## T11 — Inventory and refills  ☐

**What it is.** One inventory row per medicine: unit, total, remaining, refill threshold/amount. A daily job estimates **runout date** from weekday-averaged usage. Stock only moves when a dose is marked **taken**. Restocking is not a supported action (only threshold/amount may be edited later).

**Steps** (W2, Metformin)
1. Medicine → **Inventory** section → create inventory: unit *tablet*, total 30, remaining 30, refill threshold 10, refill amount 30.
2. After a schedule exists, the **estimated runout date** appears (30 tablets ÷ daily use).
3. Edit **refill threshold / amount** → saves. Try to change *remaining* directly → not possible (by design).
4. **Make a refill alert appear:** create inventory with remaining **3** and a daily schedule of 1 unit. Then run the job by hand:
   ```powershell
   Set-Location D:\MediTrack-App\server
   node src\jobs\inventoryJob.js
   ```
   (or add a patient id: `node src\jobs\inventoryJob.js <patientId>`)
5. Open **Dashboard** → **Refill alerts** lists the medicine (runout within 7 days). Open **Notifications** → a *refill* notice ("Refill needed: …"). Run the job again → **no duplicate** notice the same day.
6. **Zero stock rule:** stock ≤ 0 → runout date = *now* (not a fake future date). No active schedules → runout date empty.

---

## T12 — Today's doses (taken / skipped / snooze)  ☐

**What it is.** Each scheduled time becomes a **dose log** (status `pending`). The patient (or a full-access caregiver) sets it to taken / skipped / snoozed. Marking **taken** does two things in *one* database transaction: set status **and** subtract the schedule's `doseAmount` from inventory (for taper schedules, the step covering the dose's own scheduled date). Only a real change *into* taken subtracts; repeating it doesn't subtract again; taken → skipped does not restock.

**Steps** (W2, Patient One)
1. Open **Today's doses** (rail/menu). Doses appear in time order, each *pending*. If none: wait up to a minute (catch-up job), or run `node src\jobs\doseLogJob.js` from the `server` folder.
2. Click **Taken** on one dose. Status flips; a toast appears.
3. Open the medicine → **Inventory**: remaining dropped by exactly the dose amount (e.g. 30 → 29).
4. Click **Taken** on the same dose again (if the button is still offered) or repeat via the API in step 6: inventory must **not** drop a second time.
5. Mark a different dose **Skipped** → inventory unchanged.
6. *(API double-tap proof)* Terminal E:
   ```powershell
   $today = Invoke-RestMethod "$api/api/dose-logs/today" -Headers $headers
   $today | ConvertTo-Json -Depth 6      # find one pending dose's "id"
   $id = <that id>
   $b = '{"status":"taken"}'
   Invoke-RestMethod "$api/api/dose-logs/$id" -Method Patch -Headers $headers -ContentType 'application/json' -Body $b
   Invoke-RestMethod "$api/api/dose-logs/$id" -Method Patch -Headers $headers -ContentType 'application/json' -Body $b
   ```
   Inventory drops **once**, not twice.
7. *(Idempotent generation)* Run `node src\jobs\doseLogJob.js` from `server` twice → second run creates 0 new rows (check **DoseLog** in Prisma Studio — no duplicates for the same schedule + time).
8. Dashboard "today" boundary: doses belong to *your timezone's* day (23-hour and 25-hour DST days are handled).

**Caregiver view.** W1 → Patient One (full_access): can use the same dose buttons. Patient Two (view_only): sees doses but **no** action buttons. Patient Three (alerts_only): doses section is **restricted/absent**.

---

## T13 — Adherence: percentage, heatmap, streaks  ☐

**What it is.** Adherence % = taken ÷ scheduled. The **heatmap** shows each day; **streaks** show the *current* run of perfect days ending today and the *best* run ever (a gap resets the count). Rolling 7/30-day % is a weighted total (not an average of daily %s). A same-day update arrives live (`stats-updated` socket event).

**Steps**
1. W2: open **Adherence**. After T12 you should see today's counts and a percentage.
2. Mark another dose taken → the numbers update **without reloading**.
3. Run the aggregation jobs by hand to roll up history:
   ```powershell
   Set-Location D:\MediTrack-App\server
   node src\jobs\adherenceJob.js
   node src\jobs\weeklyAdherenceJob.js
   ```
4. Reload **Adherence**: heatmap colours today; **Streaks** shows current/best.
5. Status honesty: `missed` is *only* for doses that were really missed. `pending`, `snoozed`, `skipped` are never counted as missed in the weekly report; however in the **aggregate** job, pending/snoozed doses from past days count as missed (so server downtime lowers adherence — a documented limitation).
6. Caregiver: view_only/full_access see Patient adherence; alerts_only gets a restricted state.

---

## T14 — Dashboards and live refresh  ☐

**What it is.** The patient dashboard (own data) shows today's day-rail, adherence, refill alerts and insights. A caregiver's dashboard for a patient is the same data **filtered by permission**: `alerts_only` receives *only* refill alerts — the dose and adherence keys are completely **absent**, not null. After any data change, a tiny `data-changed` socket event (just ids — no health values) tells open screens of the patient and eligible caregivers to re-fetch through the normal permission-checked REST routes, after a 400 ms wait.

**Steps**
1. W2 (Patient One) open **Dashboard**; W1 (Caregiver) open **Patients → Patient One → View dashboard**. Both visible side by side.
2. In W2 open **Today's doses** and click **Taken** on a dose.
3. Watch W1: the caregiver's dashboard marker updates **in about a second, without reload, without a loading skeleton**. (Measured in testing: 0.9–1.2 s.)
4. Make W1 look at **Patient Three** (alerts_only): no dose/adherence sections; refill alerts only, with a note about restricted access.
5. In W2 edit a medication / schedule / inventory → W1's matching screens (medication list/detail, schedules, inventory) refresh. An event about *another* patient must not refresh the screen you're looking at.
6. Fallback proof: if sockets were off, the screen still refreshes on window focus and every ~30 seconds.
7. Mid-session permission change: while W1 is on Patient Two's dashboard, W3 changes it to *Alerts only* → within ≤30 s (or on focus) W1's protected sections clear and a restricted notice shows.

---

## T15 — Caregiver mode: patient list and switcher  ☐

**What it is.** A caregiver can be linked to many patients. **Patients** lists everyone with an active link and the level; the **patient switcher** (menu/sheet) changes who you're viewing; the choice survives navigation. Each page is a read-only view with a named banner.

**Steps** (W1)
1. **Patients** shows three cards (names, level, shortcuts such as Alerts / Weekly reports). Emails and health data are not on the cards.
2. Open one → banner states you're viewing *someone else's* data, read-only (full_access can act on doses per T12).
3. Use the switcher to jump to another patient; navigate to another page and back → selection is remembered.
4. A **patient cannot open their own data through the caregiver route** (`/dashboard/caregiver/<own id>` → 403) — use the normal dashboard instead.
5. Chat has **no entry** for another patient at any level (T19).

---

## T16 — Missed-dose escalation (Level 1 → Level 2) and live alert  ☐

**What it is.** A dose still *pending* after the grace period (default 30 min) gets **Level 1**: a stored notification plus a live `dose-reminder` to the patient. If it is *still* pending after a second grace window (measured from the Level 1 alert's own time), **Level 2** goes to every linked caregiver with `full_access` or `alerts_only`: a stored notification, an `EscalationAlert` row and a live `missed-dose-alert`. `view_only` caregivers get **nothing**. Taking the dose stops escalation immediately (the job checks `status != pending` every time). The job runs on a cron every 2 minutes and is idempotent. Doses created *late by catch-up* (server was down) are deliberately **skipped** so a downtime doesn't alert caregivers.

**Prepare (once)**
1. W1: log in as the caregiver → **Patients → Patient One → Alerts**. Wait for **"Live updates connected."**
2. Get Patient One's access token (Part 3.4, using `patient1`). You need the numeric **schedule id** of one of his schedules:
   ```powershell
   $meds = Invoke-RestMethod "$api/api/medications" -Headers $headers
   $meds | ConvertTo-Json -Depth 4    # note a medication "id" (e.g. 12)
   Invoke-RestMethod "$api/api/medications/12/schedules" -Headers $headers | ConvertTo-Json -Depth 4   # note a schedule "id"
   ```
   (Replace 12 with your medication id. If a response is wrapped, look inside the object for the list.)

**Run the demo** (Terminal E, token for Patient One still in `$env:ACCESS_TOKEN`)
```powershell
Set-Location D:\MediTrack-App\server
node src\routes\escalations\dev.mjs settings 0.05      # shrink grace to ~3 seconds (dev only)
node src\routes\escalations\dev.mjs overdue <scheduleId>   # create an already-overdue dose
node src\routes\escalations\dev.mjs run                # Level 1 (patient only)
node src\routes\escalations\dev.mjs run                # immediately: should create nothing
Start-Sleep -Seconds 4
node src\routes\escalations\dev.mjs run                # Level 2 → caregiver
node src\routes\escalations\dev.mjs run                # again: nothing new (already exists)
```

**You should see**
- After the 1st `run`: nothing in W1 yet. In **Patient One's** window the Notifications badge increases (Level 1 reminder).
- After the 3rd `run`: in W1 a **toast** and a **new alert row** appear **live**, no reload, with the medicine name and level.
- 2nd and 4th `run`: no duplicates.

**Resolve rules**
1. In W1 click **Resolve** *before* the dose is taken → error **"Log the dose as taken before resolving its alert."** (HTTP 409).
2. Mark that dose taken: as Patient One on **Today's doses**, or `Invoke-RestMethod "$api/api/dose-logs/<doseLogId>" -Method Patch -Headers $headers -ContentType 'application/json' -Body '{"status":"taken"}'`.
3. Click **Resolve** again → row disappears, toast **"Alert resolved."**; resolving twice is harmless (idempotent).

**Negative checks**
- **view_only (Patient Two):** repeat with Patient Two's token/schedule. In W1, Patient Two's Alerts page shows the **restricted** message and no alert ever arrives.
- **alerts_only (Patient Three):** repeat → W1 receives the Level 2 alert (alerts_only is allowed here).
- Unauthenticated socket: `node src\routes\escalations\watch-alerts.mjs` with no token → "Connection rejected: Authentication required."

**Restore the grace period when finished**
```powershell
node src\routes\escalations\dev.mjs settings 30
```
(The setting is global to the dev server. A backend restart also returns it to the env default.)

**Shortcut (optional).** `node client/tests/phase89-real.mjs --keep` once builds demo accounts and writes `client\.env.phase89-demo`; then `node client/tests/phase89-demo.mjs trigger second` and `… taken` run this whole scenario for you from the repo root.

---

## T17 — Weekly reports (job, archive, email)  ☐

**What it is.** Every Sunday 23:00 UTC (`0 23 * * 0`), for each active link with `view_only` or `full_access`, the job counts the patient's real dose rows for the finished week in code, builds an exact "facts" sentence, asks Gemini for a short plain-language summary that must **start with that sentence verbatim** and may not add any new digit (otherwise retry once, then save nothing). Data is re-read just before saving; if it changed, the job aborts and retries next time. Delivery goes by the caregiver's channel: email (real SMTP → Mailpit) or in-app; push/SMS are recorded as failed (no provider). A `weekly_summary` notification is created, linked to the patient.

**Run it by hand**
```powershell
Set-Location D:\MediTrack-App\server
node src\jobs\weeklyReportJob.js                    # all eligible patients
node src\jobs\weeklyReportJob.js <patientId>        # one patient
node src\jobs\weeklyReportJob.js <patientId> 2026-09-27   # a specific date
```
Expect a result with `created`, `sent`, `existing`, `reportIds`. **Run the same command again → `created: 0` and `existing` goes up** (no duplicate report, no second send).

> ⚠ **Unverified:** the exact date-window rule. The job reports on the *latest completed 7-day window* before the date you give (default: now). Brand-new accounts created this week have no history in that finished window, so a plain run may create nothing or an all-zero report. Options: (1) use accounts with more than a week of dose history; (2) pass a date a few days after your doses exist and see whether it accepts it; (3) run `node client/tests/phase89-real.mjs --keep` (creates history + calls the real report route) and open those demo accounts. If none works, tell me the job's output and I'll adjust.

**Check in the UI**
1. W1 → **Patients → Patient One (full_access) → Weekly reports**. The archive lists reports (date range, delivery status). **Open report**: text starts with a sentence like "From … there were N recorded doses: X taken, Y missed…" and shows **Delivery: sent**.
2. **Patient Two (view_only):** same archive works.
3. **Patient Three (alerts_only):** **Restricted access** panel (real HTTP 403 from the server). Alerts-only deliberately doesn't get adherence detail.
4. Set the caregiver's channel to **Email** (T22), run the job, open Mailpit → a weekly report email arrives.
5. Open **Notifications** → a weekly summary entry whose link goes to that patient's weekly-reports section (T21).
6. Prisma Studio → **WeeklySummaryReport**: one row per caregiver + patient + week.

---

## T18 — The permission matrix (the single most important check)  ☐

**What it is.** Everything a caregiver can see is decided by `checkPermission` against the *current* link, on every request. This is the table to confirm. In W1 choose each patient and click through each page.

| Page / feature (viewing a patient) | Patient One **full_access** | Patient Two **view_only** | Patient Three **alerts_only** |
|---|---|---|---|
| Dashboard | full | full (read-only) | refill alerts only |
| Medications / doctors / scans (read) | ✅ | ✅ | ❌ restricted |
| Add / edit / delete medicines, doctors, schedules, inventory, upload scan | ✅ | ❌ no buttons | ❌ |
| Today's doses (read) | ✅ | ✅ | ❌ |
| Change a dose status | ✅ | ❌ | ❌ |
| Adherence, heatmap, streaks | ✅ | ✅ | ❌ |
| **Alerts** (live + list) | ✅ | ❌ restricted | ✅ |
| **Weekly reports** | ✅ | ✅ | ❌ restricted |
| Insights & interaction flags (read) | ✅ | ✅ | ❌ restricted |
| Dismiss / acknowledge an insight | ✅ | ❌ no buttons | ❌ |
| Live `data-changed` refreshes | ✅ | ✅ | ❌ none |
| Another person's **AI chat** | ❌ never | ❌ never | ❌ never |
| Another person's profile / preferences | ❌ never | ❌ never | ❌ never |

**Extra proofs**
- **Live downgrade:** W2 changes Patient One → *View only*; W1 refreshes/focuses → Alerts becomes restricted while reports still open. Restore to *Full access*.
- **Absent, not null:** the `alerts_only` response literally has no `todayDoses`/`adherence` keys (the UI detects restriction by that absence). Proven by automated test; visible as hidden sections.
- **Wrong id in URL:** edit the patient id in the browser address bar to someone you aren't linked to → blocked/404-style, no data.

---

## T19 — AI chat (private, with a forced disclaimer)  ☐

**What it is.** A private chat with Gemini per user. Gemini is called with **no tools** (it cannot write anything), the user's text is sent as untrusted data, and the app prepends the exact disclaimer to every stored reply and stamps `disclaimerShown = true` on every row (user rows too). The chat prompt includes the owner's own **active medicines (cap 30)** and **unacknowledged interaction flags (cap 20)** read from the database, with an instruction to mention only those flags and otherwise say the app can't determine interactions.

**Steps** (W3, Patient Two)
1. Open **Chat → Start new conversation**.
2. Send: *What is this medication generally used for?* While waiting, the composer is disabled and says a reply is being generated.
3. Send: *Tell me a short joke about a penguin.* Both AI messages show the **"This is not medical advice. Consult your doctor."** line — even for the non-medical joke.
4. Click **Refresh messages** — history is stored.
5. Grounding: send *Which medicines am I taking?* → the reply uses your actual medicine names. Send *Do any of my medicines interact?* → it relays only the stored warning about simvastatin + clarithromycin; for a patient with no flags (W2) it should say the app can't determine interactions and suggest a pharmacist/doctor. *(AI wording varies; judge that nothing is invented.)*
6. Validation: only spaces → Send disabled; paste 4,001 characters → disabled with explanation; 4,000 is the max.
7. Start a **medication conversation** from a medicine's **Ask about this medication**.
8. **Privacy:** W1 (caregiver, full_access on Patient One) has **no Chat link** for a patient and `…/chat?patientId=<other id>` shows *"Chat is private to its owner"*. `/chat/<someone else's conversation id>` → *Conversation not found.*
9. Concurrency (optional): send from two tabs at once → the second gets a 409 and pauses until the first reply arrives.
10. Remove `GEMINI_API_KEY` → sending shows an error (503/502) and your message may be stored without a reply; nothing breaks.

---

## T20 — Insights and drug-interaction warnings  ☐

**What it is.** (a) **Interaction flags:** whenever a medicine is added (manual or OCR) its name is checked against the **30 static, DailyMed-cited contraindicated pairs** in `DrugInteraction`. This is plain database matching — no AI. For OCR confirm, *all* medicines are created first, *then* checked, so two interacting medicines from one scan are caught. (b) **Weekly adherence insight:** one short Gemini line about the last 7 days' counts (cached per UTC week).

**Steps — interaction**
1. Patient Two (W3) already has simvastatin + clarithromycin from the scan (T8). Open **Medications → Simvastatin**: a coloured **Interaction warning · severe** banner names both medicines, shows the stored description and a clickable **DailyMed source link** (open it — real page).
2. The same warning shows on the Medications list and the Dashboard "Insights" area.
3. **Manual pair test (any patient):** add `simvastatin` then `cLaRiThRoMyCiN` (mixed case) as active medicines → flag appears automatically after the second save (matching is case-insensitive, either order).
4. W3 click **Acknowledge interaction** → it disappears with a status message; reload → still gone (acknowledged flags are never recreated). Click again → harmless.
5. Absence ≠ safety: a missing warning only means "not in the 30-pair list". The Medical disclaimer page says so.

**Steps — weekly insight**
1. Need doses from the last 7 days. Generate one by hand (dev only):
   ```powershell
   Set-Location D:\MediTrack-App\server
   node src\routes\insights\generate.mjs <patientId>
   ```
   First run → `created` (or `no_data` if no logs); run again → `cached` (same row, no second Gemini call).
2. Dashboard → **Weekly adherence insight** shows one quiet line (no alarm colour).
3. Click **Dismiss adherence insight** (full_access owner/caregiver) → disappears; reload to confirm.
4. Caregiver view: full_access sees dismiss buttons; view_only sees insights **without** buttons; alerts_only gets **Restricted access**.

**Prove Gemini can't change interaction data**
```powershell
Set-Location D:\MediTrack-App\server
rg -n "drugInteraction.create" src prisma
```
The only create is in `prisma/seed.js`. (`rg` = ripgrep. If it isn't installed use `Get-ChildItem src,prisma -Recurse -Include *.js | Select-String "drugInteraction.create"`, or rely on the automated test in Part 5.)

---

## T21 — Notifications inbox  ☐

**What it is.** A durable list of your own notices (reminder, refill, escalation, weekly_summary, system) with unread state. Caregivers also see escalation notices about patients **only while** their link still allows it (`full_access`/`alerts_only` for dose-linked notices; `full_access`/`view_only` for weekly summaries). Hidden notices are not deleted — restoring access brings them back.

**Steps**
1. After T16, open **Notifications** in W1 (caregiver) → Level 2 escalation notices appear; the rail shows a numeric badge with text (caps at `99+`).
2. Use **All / Unread** and the **type** filter (reminder, refill, escalation, weekly summary, system).
3. Reading doesn't mark as read. Click **Mark as read** → the row changes and the badge drops, announced to screen readers. Click again later → harmless (original read time kept).
4. **Load more** works for long lists. If the network fails, **Retry** retries the same page.
5. **Privacy proof:** W4 (Patient Three) changes the caregiver to **View only** → in W1 the escalation notices **disappear** and the badge falls; set back to **Alerts only** → they return.
6. Weekly summary notices link to `/patients/<id>#weekly-reports`; other types intentionally don't link (the data needed to link them safely isn't returned).
7. The badge refreshes on focus, every 60 s, and on socket events.

---

## T22 — Notification channel settings  ☐

**What it is.** Honest channel choices. Only **In the app** and **Email** are offered. Email today is honoured only for **weekly caregiver reports**; reminders, alerts and refills stay in the app. Push exists as a socket event only and SMS as a stored value only — no provider, so they are not offered.

**Steps**
1. `/settings/notifications` → channel select shows exactly two options with help text explaining the email scope.
2. Save **Email** → toast; reload → persisted.
3. If an account has a stored `push`/`sms` value (API-set), the select starts blank with a banner and **Save** is disabled until you choose a supported option.
4. Run T17's job with the caregiver on Email → an email appears in Mailpit; on In-app → a notification only.

---

## T23 — Account activity (audit log)  ☐

**What it is.** The app records sensitive actions in `AuditLog` (metadata only — never medicines, doses, notes, tokens; the IP column exists but is never filled): `login_local`, `login_google`, `caregiver_read` (one row per caregiver + patient + page-group per 10 minutes), `permission_change` (written in the *same transaction* as the permission update). `/api/audit-logs` is self-only (rows where you are the actor **or** the patient affected).

**Steps**
1. *(Optional, to see more rows)* restart the backend with `$env:CAREGIVER_READ_THROTTLE_MS='1000'` (Part 2.3).
2. Log in as the caregiver (W1) and open Patient One's dashboard, then medications.
3. In W2 (Patient One) change the caregiver's permission once.
4. W2 → **Settings → Account activity** (`/settings/activity`). You should read sentences such as: *you signed in*, *Demo Caregiver viewed your dashboard*, *you changed Demo Caregiver's permission…* — with times in your timezone, **no raw JSON, no IP**, and a banner explaining the 10-minute limit and that coverage is incomplete.
5. As the caregiver, the same page shows *your own* logins and reads. Using someone else's `userId` in the API → 403.
6. **Load more** and **Retry** work; unknown action types fall back to "an area of your record".

---

## T24 — Contact support  ☐

**What it is.** A logged-in user posts `{subject, message}`; the backend emails it to `SUPPORT_INBOX` (dev default `support@meditrack.local`, captured by Mailpit) with your email as **Reply-To**. No ticket table exists, so there are no ticket ids. Limit: 5 valid attempts per user per rolling hour (in memory; resets on restart).

**Steps**
1. Open **Contact support** (`/support`). The reply email is shown read-only.
2. Subject 1–120 characters, message 1–2,000 (counters, trimmed length). Empty/invalid → **Send** disabled.
3. Send → confirmation replaces the form. Mailpit shows the email with Reply-To = your account email.
4. Send 5 more quickly → the **6th** shows a wait-time message (HTTP 429), and your text stays in the box.
5. Stop Mailpit (`docker stop meditrack-mailpit`) and send → "Your message was not sent" (502) with text retained. `docker start meditrack-mailpit` afterwards.
6. Log out and open `/support` → asked to log in, then returned here.

---

## T25 — FAQ, Terms, Privacy, Medical disclaimer  ☐

**What it is.** Four public information pages (also reachable from the footer links) written from `docs/PRIVACY_FACTS.md` — they describe what the code actually does, with no legal-compliance claims.

**Steps**
1. Open `/faq` (11 questions; expand/collapse with Enter/Space), `/terms`, `/privacy`, `/medical-disclaimer` — signed in **and** signed out.
2. Each has exactly one main heading and an "updated" date; links to support work.
3. **Accuracy read-through** (the real test): confirm they honestly say — images stored on the server's disk, signed image links last 10 minutes even after revoke, Gemini receives the listed data, no account-deletion/export/retention features, push/SMS not delivered, fixed 30-pair interaction list, OCR must be reviewed, emergency guidance, student project.

---

## T26 — Responsive, themes, keyboard, accessibility  ☐

**Steps**
1. In browser dev tools device mode test widths **360, 768, 1280** in **light and dark** on: dashboard, medications, adherence, alerts, notifications, support, FAQ. No horizontal page scroll; wide content scrolls inside its card.
2. Keyboard only: `Tab` through a page — focus ring always visible; modals trap focus, `Esc` closes and returns focus.
3. Turn on OS "reduce motion" — no entrance animations replay.
4. Status never relies on colour alone (text/icons accompany it).
5. Automated axe checks run inside Playwright (Part 5). Real screen-reader speech is **not** tested — a stated limitation.

---

## T27 — Security spot-checks from PowerShell  ☐

```powershell
$api = 'http://127.0.0.1:3000'
# 1. No token → 401
curl.exe -i "$api/api/users/me"

# 2. Refresh rotation + logout (use a throw-away login)
$login = Invoke-RestMethod "$api/api/auth/login" -Method Post -ContentType 'application/json' -Body (@{email='meditrack.patient3@example.com';password='PatientThree#2026'}|ConvertTo-Json)
$old = $login.refreshToken
$new = Invoke-RestMethod "$api/api/auth/refresh" -Method Post -ContentType 'application/json' -Body (@{refreshToken=$old}|ConvertTo-Json)
# reuse the OLD one → 401
curl.exe -i -X POST "$api/api/auth/refresh" -H "Content-Type: application/json" -d "{`"refreshToken`":`"$old`"}"
# logout, then the NEW refresh token must be dead
Invoke-RestMethod "$api/api/auth/logout" -Method Post -Headers @{Authorization="Bearer $($new.accessToken)"}
curl.exe -i -X POST "$api/api/auth/refresh" -H "Content-Type: application/json" -d "{`"refreshToken`":`"$($new.refreshToken)`"}"
```
**Expect:** step 1 `401`; reusing the old refresh token `401`; after logout the refresh token `401`. (An access token already issued still works until its 15-minute expiry — normal.)

Also confirm: password not present in any response; `GET /api/notifications` for another user's id isn't possible (no such parameter); a caregiver token against `/api/chat/conversations` returns only *their own* conversations.

---

# Part 5 — Automated tests

Automated tests prove the *logic* quickly and repeatably. They create their own uniquely named data and clean up after themselves — they do not touch the demo accounts above (except scripts run with `--keep`). They need Docker's Postgres + Redis running. **Passing counts below are what you recorded on 7 Oct 2026.**

## 5.1 Backend (Node's built-in test runner)

```powershell
Set-Location D:\MediTrack-App\server
node --test
```

**Expect:** **33 tests pass, 0 fail.** (The server has no `npm test` script — use `node --test`.) It runs real HTTP requests against the real Postgres/Redis, starts throw-away mail servers on random ports, and stubs only Google token verification and Gemini.

Run one phase at a time when something fails:

| Area | Command (from `server`) | What it proves |
|---|---|---|
| Phase 1 auth | `node --test src/tests/auth.integration.test.js` | register → verify → login → refresh rotation → reset → logout; Google branches a/b/c |
| Phase 2 relationships | `node --test src/routes/phase2.integration.test.js` | invitation lifecycle, dual-direction links, one-winner concurrent accept, rollback on failure, `checkPermission` tiers |
| Phase 3 dashboard | `node --test src/routes/dashboard/dashboard.integration.test.js` | permission-filtered fields absent (not null), live re-check, DST day lengths 23/25 h |
| Phase 6 inventory | `node --test src/routes/inventory/phase6.integration.test.js` | runout maths, refill dedup, decrement floor at 0 |
| Phase 7 adherence | `node --test src/routes/adherence/phase7.integration.test.js` | atomic taken + decrement, no double decrement, taper step by dose date, streak maths |
| Phase 8 escalation | `node --test src/routes/escalations/phase8.integration.test.js` | Level 1/2 timing, idempotency, socket auth, view_only gets nothing |
| Phase 9 caregiver/reports | `node --test src/routes/caregiver/report-data.test.js src/routes/caregiver/phase9.integration.test.js src/routes/reports/delivery.test.js` | exact counts, no invented digits, no duplicate reports |
| Phase 10 chat/insights | `node --test src/routes/chat/phase10.integration.test.js` | disclaimer on every row, `DrugInteraction` unchanged after AI calls, flags from manual and OCR paths |
| Phase 11 notifications/audit/support | `node --test src/routes/notifications/phase11.integration.test.js` | inbox visibility after revoke/downgrade/restore, audit rows incl. rollback, throttle, support limits |
| Live-refresh event | `node --test src/routes/**/dataChanged.integration.test.js` (or just the full run) | `data-changed` reaches patient + eligible caregivers only; payload has only the listed keys |

*Optional live-Gemini run for Phase 10 (spends API quota):*
```powershell
$env:PHASE10_LIVE_GEMINI = '1'
node --test src/routes/chat/phase10.integration.test.js
Remove-Item Env:PHASE10_LIVE_GEMINI
```

> Flakiness note: the Phase 7 concurrent-update test once hit a database serialization conflict (code `P2034`). That path now retries with backoff + jitter; the isolated failure rate went to 0 of 10 runs.

## 5.2 Frontend unit tests and build

```powershell
Set-Location D:\MediTrack-App\client
npm test              # expect 20 passed, 0 failed
npm run build         # expect success; JS ≈ 476.66 kB (143.88 kB gzip), CSS ≈ 33.27 kB
```

## 5.3 Browser tests (Playwright)

```powershell
Set-Location D:\MediTrack-App\client
npx playwright test --workers=2
```

**Expect:** **69 passed, 0 failed, 2 skipped** (71 discovered). The two skips are *opt-in* tests that need their own environment — `account-mailpit.spec.js` and `dashboard-live.spec.js` — and are never counted as passes. These tests mostly use fixture API responses, run at 360/768/1280 px in light/dark, and include axe accessibility checks.

Open the HTML report if anything fails: `npx playwright show-report`.

## 5.4 Real-service scripts (no mocks; real Postgres, Redis, Chrome)

From the repo root `D:\MediTrack-App`:

```powershell
node client/tests/phase89-real.mjs      # live alert, resolve 409, weekly reports (needs Gemini key)
node client/tests/phase10-real.mjs      # chat, disclaimer, interaction warning, insights (needs Gemini key)
node client/tests/phase11-real.mjs      # inbox, privacy after downgrade, audit page, support, live refresh
```

- `phase11-real.mjs` expects **6 passed**. It needs Mailpit up (`docker start meditrack-mailpit`; SMTP 127.0.0.1:11025, UI http://127.0.0.1:8025). It measured a caregiver screen updating **0.9–1.2 s** after "Taken" with no reload.
- Each script starts its own isolated Express + Vite, creates temporary accounts and deletes them afterwards. `phase89-real.mjs --keep` keeps them and writes `client\.env.phase89-demo` for repeat demos.
- Harmless noise at the end: `[vite] ws proxy ECONNRESET` (a socket closing during teardown).
- Screenshots land in `client\.cache\phase89|phase10|phase11\` (ignored by git).

## 5.5 Optional setup self-check

```powershell
Set-Location D:\MediTrack-App\server
npm run check:setup
```
Re-verifies that the database has the expected 20 models and the Google-auth fields.

---

# Part 6 — Inspecting the database (Prisma Studio)

```powershell
Set-Location D:\MediTrack-App\server
npm run db:studio
```
Opens `http://localhost:5555`. Press `Ctrl + C` in its terminal to close. **Look, don't edit** unless a test tells you to (Studio edits bypass all the app's rules).

| Table | What to confirm |
|---|---|
| **User** | One row per email. Google rows: `authProvider=google`, `passwordHash` empty. No role column exists. `passwordHash` is a bcrypt string, never the password |
| **UserPreference** | One row per user (auto-created) |
| **CaregiverPatientLink** | `patientId`, `caregiverId`, `permissionLevel`, `status` (active / revoked…). Role is derived from which column you are |
| **Invitation** | `inviteToken`, `expiresAt` = created + 7 days, `status` |
| **Medication** | `addedVia` (ocr/manual), `status` (active/discontinued), `trackingType` |
| **MedicationSchedule** | `timeOfDay`, `daysOfWeek`, `doseAmount`, `isTaperSchedule`, `taperDetails` |
| **DoseLog** | one row per schedule + time; no duplicates; `status`, `actualActionDatetime`, `loggedByUserId` |
| **MedicineInventory** | `quantityRemaining` dropped by exactly the dose amount per *first* "taken"; `estimatedRunoutDate` |
| **PrescriptionScan** | `scanStatus` ∈ processing → needs_review → completed; `ocrRawText`, `ocrExtractedData`; `imageUrl` is a relative path |
| **EscalationAlert** | Level 1 rows (`caregiverId` null) and Level 2 rows (one per eligible caregiver); `resolutionStatus` |
| **Notification** | `notificationType`, `channel`, `relatedDoseLogId`, `relatedPatientId` (weekly summaries) |
| **WeeklySummaryReport** | unique per caregiver + patient + week; `sentStatus` |
| **AdherenceStat** | daily/weekly rows |
| **AiChatMessage** | **every** row `disclaimerShown = true` (user *and* ai) |
| **AiInsight** / **MedicationInteractionFlag** | one flag per pair (no duplicates); `acknowledged` |
| **DrugInteraction** | exactly **30** rows, each with a source URL in `sourceReference` |
| **AuditLog** | `actionType` login_local / login_google / caregiver_read / permission_change; `details` has only route/method/permission metadata; `ipAddress` is empty |

---

# Part 7 — Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `docker` not recognized | Docker not on PATH | `$env:Path = "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin;$env:Path"` |
| `/api/health` returns 503 | Postgres or Redis down | `docker ps`; `docker compose up -d --wait` |
| Website loads but every call fails | Backend not running or wrong port | Terminal C; `curl.exe http://127.0.0.1:3000/api/health` |
| Logged out on every reload | Redis down | restart Redis; log in again |
| "Session ended" after logging in elsewhere | One active session per account | log in again (expected) |
| No verification/reset/invite email | Mailpit container stopped, or `SMTP_PORT` ≠ 11025 | `docker start meditrack-mailpit`; fix `.env`; restart backend |
| Email links open the wrong site | `CLIENT_ORIGIN` mismatch (localhost vs 127.0.0.1) | align `.env` and the address you browse; restart backend |
| Scan stuck on *processing* | OCR service off / port mismatch / not finished loading | start Terminal B, wait for "startup complete"; ports must match `OCR_SERVICE_URL` |
| OCR window: cannot fetch image | `OCR_IMAGE_ORIGINS` not set | set to `http://127.0.0.1:3000`, restart OCR |
| Scan never ends, error after ~4 min | OCR slower than `OCR_REQUEST_TIMEOUT_MS` (default 240000) | raise the variable or check OCR CPU/memory |
| Chat/insight/schedule-generate fails (502/503) | Missing/invalid `GEMINI_API_KEY`, or model name not available | fix key; restart backend. Regex-only OCR still works because Gemini is only a fallback |
| "No doses are scheduled" today | No active schedule for today's weekday, or catch-up hasn't ticked | wait ≤1 min or `node src\jobs\doseLogJob.js` from `server` |
| Taken doesn't change inventory | No inventory row for that medicine | create inventory (T11) |
| Escalation never fires | Grace period still 30 min, or the dose was created late by catch-up (skipped on purpose) | use the dev demo in T16 (grace 0.05 + `overdue`) |
| Resolve says "Log the dose as taken…" | Correct behaviour (409) | mark taken first |
| Alerts page "Restricted access" | Link is `view_only` (alerts need alerts_only/full_access) | expected; change level from the patient side |
| Weekly report page restricted | Link is `alerts_only` | expected |
| Weekly job output says nothing created | Window had no data / window rule | see ⚠ in T17 |
| Job says "Report source data changed during generation" | A dose changed mid-run | re-run (the guard is working) |
| Audit page shows few `caregiver_read` rows | 10-minute throttle per caregiver + patient + area | restart backend with `CAREGIVER_READ_THROTTLE_MS=1000` |
| Support send fails with 429 | 5 per hour limit | wait or restart backend (in-memory) |
| Support send fails with 502/503 | Mailpit down / `SUPPORT_INBOX` missing in production | start Mailpit; set the variable |
| Seed says "requires manual review" | A seeded interaction row was edited | restore the row; never force |
| Port 3000/5173/8001 already in use | an old copy is still running | close that terminal, or `Get-NetTCPConnection -LocalPort 3000` to find it |
| Playwright says 2 skipped | By design (opt-in specs) | not a failure |
| `ECONNRESET` printed after real-service scripts | socket teardown noise | ignore |

---

# Part 8 — Cheat sheet and final checklist

## 8.1 Start everything (copy/paste order)

```powershell
# A — databases
Set-Location D:\MediTrack-App; docker compose up -d --wait; docker start meditrack-mailpit

# B — OCR (own window)
Set-Location D:\MediTrack-App\ocr-service; $env:OCR_IMAGE_ORIGINS='http://127.0.0.1:3000'
.\.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001

# C — backend (own window)
Set-Location D:\MediTrack-App; $env:OCR_SERVICE_URL='http://127.0.0.1:8001'; $env:PRESCRIPTION_IMAGE_ORIGIN='http://127.0.0.1:3000'
npm --prefix server run dev

# D — website (own window)
Set-Location D:\MediTrack-App; npm --prefix client run dev
```

URLs: website `:5173` · backend `:3000` (`/api/health`) · OCR `:8001` (`/health`) · Mailpit `:8025` · Prisma Studio `:5555`.

## 8.2 Job commands (run from `D:\MediTrack-App\server`)

```powershell
node src\jobs\doseLogJob.js [patientId] [YYYY-MM-DD]     # create dose rows
node src\jobs\adherenceJob.js                            # daily aggregation
node src\jobs\weeklyAdherenceJob.js                      # weekly aggregation
node src\jobs\inventoryJob.js [patientId]                # runout + refill notices
node src\jobs\weeklyReportJob.js [patientId] [YYYY-MM-DD]  # AI weekly summary + delivery
node src\routes\insights\generate.mjs [patientId]        # weekly insight
node src\routes\escalations\dev.mjs settings <minutes>   # dev: grace period
node src\routes\escalations\dev.mjs overdue <scheduleId> # dev: create overdue dose
node src\routes\escalations\dev.mjs run                  # run escalation job once
node src\routes\escalations\watch-alerts.mjs             # print live socket alerts (needs ACCESS_TOKEN)
```
The same jobs run automatically: dose rows at startup and every minute, escalation every 2 minutes (`*/2 * * * *`), weekly report Sundays 23:00 UTC, inventory and aggregation on their own schedules. Dev HTTP helper routes return **404 in production** by design.

## 8.3 Things that are deliberate (don't report as bugs)

- Invitations always start as **View only**; only the patient upgrades.
- OCR **always** needs your review; confirming creates only doctors + medicines.
- Caregivers never see another person's AI chat — at any level.
- `alerts_only` ≠ "less than view_only": it gets alerts but **not** doses, adherence, reports or insights. `view_only` gets those but **no** live alerts.
- Push and SMS are not delivered (no provider). Email honoured only for weekly reports.
- Signed prescription-image links stay valid up to **10 minutes** after a revoke.
- Downtime lowers adherence numbers (past pending/snoozed count as missed in the aggregate job).
- Audit shows at most one caregiver-read per caregiver + patient + area per 10 minutes, and does not cover every disclosure.
- No account deletion, data export or retention limits exist. No regulatory-compliance claim is made.
- Refresh token lives in `sessionStorage` (moving to an httpOnly cookie is Phase 12).
- Dashboard may call Gemini inside a request (can be slower on a cold insight).
- OCR accuracy numbers are from **15 synthetic printed prescriptions**, not real photos or handwriting.
- Real screen-reader speech and real Google-hosted sign-in were not part of automated checks.

## 8.4 Final pass/fail checklist

| # | Area | Pass? |
|---|---|---|
| T1 | Sign-up + email verification | ☐ |
| T2 | Login / reload / logout | ☐ |
| T3 | Forgot + reset password | ☐ |
| T4 | Google Sign-In (optional) | ☐ |
| T5 | Profile, settings, preferences | ☐ |
| T6 | Invite → accept → permissions → revoke | ☐ |
| T7 | Doctors | ☐ |
| T8 | OCR scan → review → confirm | ☐ |
| T9 | Manual medicines | ☐ |
| T10 | Schedules (manual, AI, taper) | ☐ |
| T11 | Inventory + refill alert | ☐ |
| T12 | Taken / skipped + inventory decrement | ☐ |
| T13 | Adherence + heatmap + streaks | ☐ |
| T14 | Dashboards + live refresh | ☐ |
| T15 | Caregiver patient list + switcher | ☐ |
| T16 | Escalation Level 1/2 + resolve | ☐ |
| T17 | Weekly reports (job, archive, email) | ☐ |
| T18 | Permission matrix (all 3 levels) | ☐ |
| T19 | AI chat + disclaimer + privacy | ☐ |
| T20 | Interaction warning + weekly insight | ☐ |
| T21 | Notifications inbox + privacy | ☐ |
| T22 | Channel settings | ☐ |
| T23 | Account activity (audit) | ☐ |
| T24 | Contact support + rate limit | ☐ |
| T25 | FAQ / Terms / Privacy / Disclaimer | ☐ |
| T26 | Responsive / themes / keyboard | ☐ |
| T27 | Security spot-checks | ☐ |
| 5.1 | `node --test` → 33 pass | ☐ |
| 5.2 | `npm test` → 20 pass; build OK | ☐ |
| 5.3 | Playwright → 69 pass, 2 skipped | ☐ |
| 5.4 | phase89 / phase10 / phase11 real scripts | ☐ |

When every box is ticked, Phases 0–11 are verified end to end. What remains is **Phase 12**: extra unit tests, hardening, deployment, README and demo video.
