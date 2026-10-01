// Real HTTP, Socket.io, PaddleOCR, Gemini attempt, disk images and PostgreSQL.
// Run with local services started: node src/routes/prescription-scans/verify-real.mjs
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import bcrypt from 'bcrypt';
import { io } from '../../../../client/node_modules/socket.io-client/build/esm/index.js';
import prisma from '../../prismaClient.js';

const origin = process.env.TEST_API_ORIGIN || 'http://127.0.0.1:3000';
const fixtureRoot = new URL('../../../../ocr-service/tests/', import.meta.url);
const resultsRoot = new URL('results/', fixtureRoot);
const password = `Phase4-${randomUUID()}`;
const email = `phase4-${randomUUID()}@example.test`;
let socket;
try {
  const user = await prisma.user.create({ data: { fullName: 'Phase 4 OCR Demo', email,
    passwordHash: await bcrypt.hash(password, 12), emailVerified: true,
    preferences: { create: { preferredNotificationChannel: 'in_app', timezone: 'Asia/Kolkata' } } } });
  const loginResponse = await fetch(`${origin}/api/auth/login`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  assert.equal(loginResponse.status, 200);
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.accessToken}` };
  await writeFile(new URL('.env.demo', fixtureRoot), `DEMO_EMAIL=${email}\nDEMO_PASSWORD=${password}\nDEMO_USER_ID=${user.id}\n`);
  socket = io(origin, { auth: { token: login.accessToken }, reconnection: false });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const events = new Map();
  const waiters = new Map();
  socket.on('scan-complete', (event) => { events.set(event.scanId, event); waiters.get(event.scanId)?.(event); });
  function waitForScan(id) {
    if (events.has(id)) return Promise.resolve(events.get(id));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Scan ${id} timed out`)), 150000);
      waiters.set(id, (event) => { clearTimeout(timer); waiters.delete(id); resolve(event); });
    });
  }
  async function post(path, body) {
    return fetch(`${origin}/api/prescription-scans${path}`, { method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }
  await mkdir(resultsRoot, { recursive: true });
  const summary = { patientId: user.id, runs: [] };
  let rx04;
  for (const fixture of ['rx_01', 'rx_04', 'rx_08']) {
    const bytes = await readFile(new URL(`${fixture}.jpg`, fixtureRoot));
    const form = new FormData(); form.append('image', new Blob([bytes], { type: 'image/jpeg' }), `${fixture}.jpg`);
    const started = performance.now();
    const uploaded = await fetch(`${origin}/api/prescription-scans`, { method: 'POST', headers, body: form });
    assert.equal(uploaded.status, 202, await uploaded.clone().text());
    const pending = await uploaded.json();
    const uploadMs = Math.round(performance.now() - started);
    assert.equal(pending.scanStatus, 'processing');
    const event = await waitForScan(pending.scanId);
    assert.equal(event.scanStatus, 'needs_review');
    const response = await fetch(`${origin}/api/prescription-scans/${pending.scanId}`, { headers });
    assert.equal(response.status, 200);
    const scan = await response.json();
    assert.equal(scan.scanStatus, 'needs_review');
    assert.equal(scan.medicationId, null); assert.equal(scan.doctorId, null);
    assert.equal(await prisma.medication.count({ where: { patientId: user.id } }), 0);
    assert.ok(scan.ocrRawText.length > 100);
    assert.ok(scan.ocrExtractedData.medicines.length > 0);
    assert.equal((await fetch(scan.imageReadUrl)).status, 200);
    assert.equal((await fetch(origin + scan.imageUrl)).status, 403);
    const extraction = { doctor: scan.ocrExtractedData.doctor, medicines: scan.ocrExtractedData.medicines,
      ocrRawText: scan.ocrRawText, ocrConfidenceScore: scan.ocrExtractedData.nativeConfidence };
    await writeFile(new URL(`${fixture}.json`, resultsRoot), JSON.stringify(extraction, null, 2) + '\n');
    summary.runs.push({ fixture, scanId: scan.id, uploadMs, totalMs: Math.round(performance.now() - started), event,
      confidence: extraction.ocrConfidenceScore, medicineCount: extraction.medicines.length });
    console.log(JSON.stringify(summary.runs.at(-1)));
    if (fixture === 'rx_04') rx04 = scan;
  }
  assert.equal(rx04.ocrExtractedData.doctor.doctorName, 'Arjun Mehta');
  assert.deepEqual(rx04.ocrExtractedData.medicines.map((m) => [m.medicineName, m.dosageAmount, m.dosageUnit]), [
    ['Vitamin D3', 1000, 'IU'], ['Ceftriaxone', 1, 'g'], ['Lactulose', 10, 'ml'], ['Clotrimazole', 1, 'g'], ['Paracetamol', 500, 'mg'],
  ]);
  const confirmed = { reviewed: true, doctor: rx04.ocrExtractedData.doctor,
    medicines: rx04.ocrExtractedData.medicines.map((m) => ({ ...m, startDate: new Date().toISOString().slice(0, 10),
      trackingType: m.medicineForm === 'syrup' ? 'volume_ml' : m.medicineForm === 'ointment' ? 'weight_grams' : 'countable' })) };
  // Test credentials and writes are confined to this synthetic fixture account.
  assert.equal((await post(`/${rx04.id}/confirm`, { ...confirmed, reviewed: false })).status, 400);
  assert.equal((await post(`/${rx04.id}/confirm`, { ...confirmed, medicines: [{ ...confirmed.medicines[0], medicineForm: 'pill' }] })).status, 400);
  const confirmations = await Promise.all([post(`/${rx04.id}/confirm`, confirmed), post(`/${rx04.id}/confirm`, confirmed)]);
  assert.deepEqual(confirmations.map((r) => r.status).sort(), [200, 409]);
  const saved = await confirmations.find((r) => r.status === 200).json();
  assert.equal(saved.scan.scanStatus, 'completed'); assert.ok(saved.scan.reviewedAt);
  assert.equal(saved.medications.length, 5);
  assert.equal(await prisma.medication.count({ where: { patientId: user.id, addedVia: 'ocr_scan', doctorId: saved.doctor.id } }), 5);
  assert.equal((await prisma.doctor.findUnique({ where: { id: saved.doctor.id } })).source, 'ocr_scan');
  summary.confirmation = { scanId: rx04.id, doctorId: saved.doctor.id, medicationIds: saved.medications.map((m) => m.id),
    scanStatus: saved.scan.scanStatus, reviewedAt: saved.scan.reviewedAt };
  // Check ownership, all caregiver levels and revocation against the real database.
  const caregiver = await prisma.user.create({ data: { fullName: 'Phase 4 Permission Test', email: `permission-${randomUUID()}@example.test`,
    passwordHash: await bcrypt.hash(password, 12), emailVerified: true } });
  let link;
  try {
    const auth = await (await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: caregiver.email, password }) })).json();
    const caregiverHeaders = { Authorization: `Bearer ${auth.accessToken}` };
    const get = () => fetch(`${origin}/api/prescription-scans/${rx04.id}`, { headers: caregiverHeaders });
    assert.equal((await get()).status, 403);
    link = await prisma.caregiverPatientLink.create({ data: { caregiverId: caregiver.id, patientId: user.id,
      relationshipType: 'test', permissionLevel: 'alerts_only', status: 'active' } });
    assert.equal((await get()).status, 403);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'view_only' } });
    assert.equal((await get()).status, 200);
    assert.equal((await fetch(`${origin}/api/prescription-scans/${rx04.id}/confirm`, { method: 'POST', headers: { ...caregiverHeaders,
      'Content-Type': 'application/json' }, body: JSON.stringify(confirmed) })).status, 403);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { permissionLevel: 'full_access' } });
    assert.equal((await get()).status, 200);
    await prisma.caregiverPatientLink.update({ where: { id: link.id }, data: { status: 'revoked' } });
    assert.equal((await get()).status, 403);
  } finally {
    if (link) await prisma.caregiverPatientLink.delete({ where: { id: link.id } });
    await prisma.user.delete({ where: { id: caregiver.id } });
  }
  await writeFile(new URL('verification.json', resultsRoot), JSON.stringify(summary, null, 2) + '\n');
  console.log('PASS: real images, async socket completion, mandatory review, transaction, permissions, duplicate-confirm protection.');
  console.log(JSON.stringify(summary.confirmation));
  console.log('Demo account retained for Studio/UI. Credentials: ocr-service/tests/.env.demo (ignored).');
} finally { socket?.disconnect(); await prisma.$disconnect(); }
