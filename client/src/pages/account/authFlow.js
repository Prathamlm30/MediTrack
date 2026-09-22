import { verifyEmail } from '../../api/auth.js';

export function passwordError(value) {
  const bytes = new TextEncoder().encode(value).length;
  if (value.length < 8) return 'Use at least 8 characters (8 UTF-8 bytes minimum).';
  if (bytes > 72) return `Your password is ${bytes} UTF-8 bytes. Use 72 bytes or fewer.`;
  return '';
}
export const passwordHelp = 'Use at least 8 characters and no more than 72 UTF-8 bytes. Accented letters and emoji can use more than one byte. 72 bytes is bcrypt’s real limit.';
export const authPath = (path, token) => token ? `${path}?inviteToken=${encodeURIComponent(token)}` : path;

// Only invitation context is stored across email tabs. Refresh tokens stay in sessionStorage.
const pendingKey = 'meditrack.pending-registration';
export function rememberRegistration(email, inviteToken) {
  try { localStorage.setItem(pendingKey, JSON.stringify({ email, inviteToken, expires: Date.now() + 86400000 })); } catch { /* The original tab's query still carries the invitation. */ }
}
export function pendingRegistration() {
  try {
    const value = JSON.parse(localStorage.getItem(pendingKey));
    if (value?.expires > Date.now()) return value;
    localStorage.removeItem(pendingKey);
  } catch { /* Storage may be unavailable. */ }
  return null;
}
export function clearRegistration() { try { localStorage.removeItem(pendingKey); } catch { /* Optional context. */ } }

// StrictMode replays effects; consuming a verification token twice would turn success into failure.
const verifications = new Map();
export function verifyOnce(token) {
  if (!verifications.has(token)) {
    const result = verifyEmail(token).catch((error) => {
      verifications.delete(token);
      throw error;
    });
    verifications.set(token, result);
  }
  return verifications.get(token);
}
