import { io } from '../../../../client/node_modules/socket.io-client/build/esm/index.js';
if (!process.env.ACCESS_TOKEN) throw new Error('Set ACCESS_TOKEN to your login access token.');
const socket = io(process.env.TEST_API_ORIGIN || 'http://127.0.0.1:3000', {
  auth: { token: process.env.ACCESS_TOKEN }, reconnection: false,
});
socket.on('connect', () => console.log('Listening for scan-complete. Upload your image now.'));
socket.on('scan-complete', (event) => console.log('scan-complete', JSON.stringify(event)));
socket.on('connect_error', (error) => { console.error(error.message); socket.disconnect(); process.exitCode = 1; });
