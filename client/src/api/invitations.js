import { request, API_BASE_URL } from './client.js';
const path = (token) => `/api/invitations/${encodeURIComponent(token)}`;
export const invite = ({ inviteeEmail, relationshipType, proposedRole }) => request('/api/invitations', { method: 'POST', body: { inviteeEmail, relationshipType, proposedRole } });
export const preview = (token, options) => request(path(token), { ...options, auth: false });
export const accept = (token) => request(`${path(token)}/accept`, { method: 'POST' });
export const decline = (token) => request(`${path(token)}/decline`, { method: 'POST' });
// A native POST follows the public 303 across origins without a fetch CORS redirect.
export const publicAcceptAction = (token) => `${API_BASE_URL}${path(token)}/accept`;
