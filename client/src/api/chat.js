import { request } from './client.js';

// Deliberately no patient scope: these endpoints always belong to the caller.
export const getConversations = (options) => request('/api/chat/conversations', options);
export const createConversation = (relatedMedicationId) => request('/api/chat/conversations', {
  method: 'POST', body: relatedMedicationId ? { relatedMedicationId } : {},
});
export const getMessages = (id, options) => request(`/api/chat/conversations/${encodeURIComponent(id)}/messages`, options);
export const sendMessage = (id, messageText) => request(`/api/chat/conversations/${encodeURIComponent(id)}/messages`, {
  method: 'POST', body: { messageText },
});
