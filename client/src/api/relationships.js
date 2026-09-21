import { request } from './client.js';
export const getRelationships = (options) => request('/api/relationships', options);
export const setPermission = (id, permissionLevel) => request(`/api/relationships/${encodeURIComponent(id)}/permissions`, { method: 'PATCH', body: { permissionLevel } });
export const revoke = (id) => request(`/api/relationships/${encodeURIComponent(id)}/permissions`, { method: 'PATCH', body: { status: 'revoked' } });
