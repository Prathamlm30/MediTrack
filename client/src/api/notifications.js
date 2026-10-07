import { request } from './client.js';

export function getNotifications({ type, unread, cursor, limit = 20 } = {}, options) {
  const query = new URLSearchParams({ limit });
  if (type) query.set('type', type);
  if (unread) query.set('unread', 'true');
  if (cursor != null) query.set('cursor', cursor);
  return request(`/api/notifications?${query}`, options);
}
export const markNotificationRead = (id) => request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: {} });
export const badgeLabel = (count) => count > 99 ? '99+' : String(count);
export const isUnread = (row) => row.readAt == null && row.status !== 'read';
