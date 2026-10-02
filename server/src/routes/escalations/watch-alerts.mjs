import { io } from '../../../../client/node_modules/socket.io-client/build/esm/index.js';

// With ACCESS_TOKEN unset this intentionally demonstrates authentication failure.
const socket = io(process.env.TEST_API_ORIGIN || 'http://127.0.0.1:3000', {
  auth: { token: process.env.ACCESS_TOKEN || '' }, reconnection: false,
});
socket.on('connect', () => console.log('Connected. Listening for missed-dose-alert and dose-reminder.'));
socket.on('missed-dose-alert', (payload) => console.log('missed-dose-alert', JSON.stringify(payload)));
socket.on('dose-reminder', (payload) => console.log('dose-reminder', JSON.stringify(payload)));
socket.on('connect_error', (error) => {
  console.error(`Connection rejected: ${error.message}`); socket.disconnect(); process.exitCode = 1;
});
process.on('SIGINT', () => socket.disconnect());
