import { Server } from 'socket.io';
import prisma from '../../prismaClient.js';
import verifyJWT from '../../middleware/verifyJWT.js';
import { storage } from './storage.js';
import { validateExtraction } from './validation.js';
import { escalationEmitters } from '../../sockets/index.js';

// One Express process for the local demo. Processing rows are the durable queue;
// restarting Express resumes outstanding scans without another upload.
export function installScanRuntime(server) {
  const io = new Server(server, { cors: { origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173' } });
  io.use(async (socket, next) => {
    try {
      const req = { headers: { authorization: `Bearer ${socket.handshake.auth?.token || ''}` } };
      await verifyJWT(req, {}, () => {});
      socket.data.userId = req.user.id;
      next();
    } catch { next(new Error('Authentication required.')); }
  });
  io.on('connection', (socket) => socket.join(`user:${socket.data.userId}`));
  let running = false;
  let stopped = false;
  let active;
  async function drain() {
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped) {
        const scan = await prisma.prescriptionScan.findFirst({ where: { scanStatus: 'processing' }, orderBy: { id: 'asc' } });
        if (!scan) break;
        const uploaderId = scan.ocrExtractedData?.uploadedByUserId || scan.patientId;
        let status;
        try {
          const response = await fetch(new URL('/extract', process.env.OCR_SERVICE_URL || 'http://127.0.0.1:8001'), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageUrl: storage.readUrl(scan.imageUrl) }), signal: AbortSignal.timeout(240000),
          });
          if (!response.ok) throw new Error(`OCR HTTP ${response.status}`);
          const data = validateExtraction(await response.json());
          await prisma.prescriptionScan.update({ where: { id: scan.id }, data: {
            ocrRawText: data.ocrRawText, ocrConfidenceScore: data.ocrConfidenceScore,
            ocrExtractedData: { doctor: data.doctor, medicines: data.medicines,
              // Decimal(5,2) rounds native ~0.989 confidence; retain full precision here.
              nativeConfidence: data.ocrConfidenceScore }, scanStatus: 'needs_review',
          } });
          status = 'needs_review';
        } catch (error) {
          console.error(`Prescription scan ${scan.id} failed:`, error.name);
          await prisma.prescriptionScan.update({ where: { id: scan.id }, data: { scanStatus: 'failed' } });
          status = 'failed';
        }
        // Payload contains no health fields. Every GET rechecks current permissions.
        io.to(`user:${uploaderId}`).emit('scan-complete', { scanId: scan.id, scanStatus: status });
      }
    } catch (error) { console.error('Prescription worker unavailable:', error.name); }
    finally { running = false; }
  }
  const kick = () => { if (!running && !stopped) active = drain(); };
  const interval = setInterval(kick, 2000);
  interval.unref();
  server.on('listening', kick);
  return { kick, ...escalationEmitters(io), emitStatsUpdated(patientId, date) {
    io.to(`user:${patientId}`).emit('stats-updated', { patientId, date });
  }, async close() {
    stopped = true; clearInterval(interval);
    await active;
    await new Promise((resolve) => io.close(resolve));
  } };
}
