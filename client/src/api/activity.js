import { request } from './client.js';
export const getActivity = (cursor, options) => request(`/api/audit-logs?limit=20${cursor == null ? '' : `&cursor=${encodeURIComponent(cursor)}`}`, options);
