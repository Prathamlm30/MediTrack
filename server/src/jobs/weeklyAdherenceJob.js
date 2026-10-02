import { runAdherenceJob } from './adherenceJob.js';
import { startLocalJob, runCli } from './phase7Runtime.js';

export const runWeeklyAdherenceJob = (options = {}) => runAdherenceJob({ ...options, weekly: true });
export const startWeeklyAdherenceJob = () => startLocalJob('weeklyAdherenceJob', 10, runWeeklyAdherenceJob, true);
await runCli(import.meta.url, runWeeklyAdherenceJob);
