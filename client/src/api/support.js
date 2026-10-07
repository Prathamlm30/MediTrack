import { request } from './client.js';
export const sendSupport = ({ subject, message }) => request('/api/support-tickets', { method: 'POST', body: { subject, message }, responseMeta: true });

export function supportOutcome(status, retryAfter, now = Date.now()) {
  if (status === 201) return { sent: true };
  if (status === 400) return { message: 'Your message was not sent. Check the subject (1–120 characters) and message (1–2,000 characters).', validation: true };
  if (status === 429) {
    const seconds = retryAfter == null ? NaN : /^\d+$/.test(String(retryAfter)) ? Number(retryAfter) : (Date.parse(retryAfter) - now) / 1000;
    const wait = Number.isFinite(seconds) ? `${Math.max(1, Math.ceil(seconds / 60))} minute${Math.ceil(seconds / 60) > 1 ? 's' : ''}` : 'up to one hour';
    return { message: `Your message was not sent. The hourly support limit has been reached. Wait ${wait} before trying again.` };
  }
  if (status === 502) return { message: 'Your message was not sent because the mail service could not accept it. Try again later.' };
  if (status === 503) return { message: 'Your message was not sent because the support inbox is not configured. Try again later.' };
  return { message: 'We could not confirm that your message was sent. Check your connection and try again.' };
}
export function supportValidation(subject, message) {
  return {
    subject: !subject.trim() ? 'Enter a subject.' : subject.trim().length > 120 ? 'Use 120 characters or fewer.' : '',
    message: !message.trim() ? 'Enter a message.' : message.trim().length > 2000 ? 'Use 2,000 characters or fewer.' : '',
  };
}
