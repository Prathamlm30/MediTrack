import app from './app.js';
import prisma from './prismaClient.js';
import redis from './config/redis.js';

const host = process.env.HOST || '127.0.0.1';
const port = Number(process.env.PORT || 3000);


let server;
let stopping = false;

async function shutdown(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  const timeout = setTimeout(() => process.exit(1), 10000);
  timeout.unref();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  redis.disconnect();
  await prisma.$disconnect();
  process.exitCode = exitCode;
}

process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

try {
  await Promise.all([prisma.$connect(), redis.connect()]);
  server = app.listen(port, host, () => {
    console.log(`MediTrack server listening at http://${host}:${port}`);
  });
  server.on('error', (error) => {
    console.error('Server error:', error.message);
    void shutdown(1);
  });
} catch (error) {
  console.error('Server startup failed:', error.message);
  await shutdown(1);
}
