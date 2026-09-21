import { request } from './client.js';
export const getMe = (options) => request('/api/users/me', options);
export const updateMe = ({ fullName, phoneNumber, address, profilePictureUrl }) => request('/api/users/me', { method: 'PATCH', body: { fullName, phoneNumber, address, profilePictureUrl } });
export const updatePreferences = ({ preferredNotificationChannel, language, theme, timezone }) => request('/api/users/me/preferences', { method: 'PATCH', body: { preferredNotificationChannel, language, theme, timezone } });
