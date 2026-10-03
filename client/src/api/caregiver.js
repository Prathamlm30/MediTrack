import { request } from './client.js';

export const getActiveAlerts = (patientId, options) => request(`/api/escalations/active?patientId=${encodeURIComponent(patientId)}`, options);
export const resolveAlert = (id) => request(`/api/escalations/${id}/resolve`, { method: 'PATCH', body: {} });
export const getWeeklyReports = (patientId, options) => request(`/api/reports/weekly?patientId=${encodeURIComponent(patientId)}`, options);
export const getWeeklyReport = (id, options) => request(`/api/reports/weekly/${id}`, options);
