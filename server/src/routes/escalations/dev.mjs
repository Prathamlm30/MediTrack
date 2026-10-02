// Run against the running server so delivery uses its existing Socket.io rooms.
const [command, argument, extra] = process.argv.slice(2);
if (extra || !['run', 'overdue', 'settings'].includes(command) ||
    (command !== 'run' && argument === undefined)) {
  throw new Error('Usage: node src/routes/escalations/dev.mjs run [patientId] | overdue <scheduleId> | settings <gracePeriodMinutes>');
}
if (!process.env.ACCESS_TOKEN) throw new Error('Set ACCESS_TOKEN to your login access token.');
if (command !== 'settings' && argument !== undefined &&
    (!/^[1-9]\d*$/.test(argument) || !Number.isSafeInteger(Number(argument)))) {
  throw new Error('The patient or schedule ID must be a positive integer.');
}
const path = command === 'run' ? '/escalations/jobs/run' : command === 'overdue' ? '/escalations/dev/overdue-dose' : '/escalation-settings';
const body = command === 'run' ? (argument === undefined ? {} : { patientId: Number(argument) })
  : command === 'overdue' ? { scheduleId: Number(argument) } : { gracePeriodMinutes: Number(argument) };
const response = await fetch(`${process.env.TEST_API_ORIGIN || 'http://127.0.0.1:3000'}/api${path}`, {
  method: command === 'settings' ? 'PATCH' : 'POST',
  headers: { Authorization: `Bearer ${process.env.ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
console.log(response.status, JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exitCode = 1;
