import { request } from './client.js';
export const getPatientDashboard = (options) => request('/api/dashboard/patient', options);
export const getCaregiverDashboard = (id, options) => request(`/api/dashboard/caregiver/${encodeURIComponent(id)}`, options);
export const getMyPatients = (options) => request('/api/dashboard/my-patients', options);
