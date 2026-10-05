import { request } from './client.js';

export const getInsights = (patientId, options) => request(`/api/insights?patientId=${encodeURIComponent(patientId)}`, options);
// The composite ID chooses the table. No patientId belongs in this body.
export const dismissInsight = (dismissId, kind) => request(`/api/insights/${encodeURIComponent(dismissId)}/dismiss`, {
  method: 'PATCH', body: { kind },
});
