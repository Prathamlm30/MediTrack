export const API_BASE_URL = (import.meta.env?.VITE_API_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '');
export const SESSION_ENDED = 'Your session ended. Sign in again to continue.';
const storageKey = 'meditrack.refresh';
let session = null;
let refreshPromise = null;
let bootPromise = null;
let generation = 0;
const listeners = new Set();
const queue = new Set();
const readRefresh = () => { try { return sessionStorage.getItem(storageKey); } catch { return null; } };
function publish(next) {
  session = next;
  try { if (next?.refreshToken) sessionStorage.setItem(storageKey, next.refreshToken); else sessionStorage.removeItem(storageKey); } catch { /* Memory-only if storage is unavailable. */ }
  listeners.forEach((listener) => listener());
}
export const getSession = () => session;
export const subscribeSession = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function setSession(next) { generation++; publish(next); }
export class ApiError extends Error {
  constructor(message, status) { super(message); this.name = 'ApiError'; this.status = status; }
}
function endSession() {
  setSession(null);
  if (typeof window !== 'undefined') window.location.replace('/login?notice=session-ended');
}
async function send(path, { body, headers, ...options } = {}, accessToken) {
  const requestHeaders = new Headers(headers);
  if (accessToken) requestHeaders.set('Authorization', `Bearer ${accessToken}`);
  if (body != null && !(body instanceof FormData)) {
    requestHeaders.set('Content-Type', 'application/json');
    if (typeof body !== 'string') body = JSON.stringify(body);
  }
  let response;
  try { response = await fetch(`${API_BASE_URL}${path}`, { ...options, body, headers: requestHeaders }); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new ApiError('Could not reach MediTrack. Check your connection and try again.', 0); }
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new ApiError(data?.error || 'Request failed. Try again.', response.status);
  return data;
}
export function refreshSession() {
  if (refreshPromise) return refreshPromise;
  const epoch = generation;
  const refreshToken = session?.refreshToken || readRefresh();
  refreshPromise = Promise.resolve().then(async () => {
    try {
      if (!refreshToken) throw new ApiError(SESSION_ENDED, 401);
      const tokens = await send('/api/auth/refresh', { method: 'POST', body: { refreshToken } });
      if (epoch !== generation) throw new ApiError('Session changed. Try again.', 401);
      publish({ ...session, ...tokens });
      return session;
    } catch (error) {
      if (epoch === generation) endSession();
      throw error;
    } finally { refreshPromise = null; }
  });
  return refreshPromise;
}
// Independent request continuations queue behind exactly one token rotation.
function waitForRefresh(signal) {
  return new Promise((resolve, reject) => {
    const entry = { resolve, reject };
    queue.add(entry);
    const finish = (callback, value) => {
      if (!queue.delete(entry)) return;
      signal?.removeEventListener('abort', abort);
      callback(value);
    };
    const abort = () => finish(reject, new DOMException('Aborted', 'AbortError'));
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    refreshSession().then((value) => finish(resolve, value), (error) => finish(reject, error));
  });
}
export async function request(path, { auth = true, ...options } = {}) {
  if (auth && refreshPromise) await waitForRefresh(options.signal);
  const epoch = generation;
  const accessToken = auth ? session?.accessToken : null;
  try { return await send(path, options, accessToken); }
  catch (error) {
    if (!auth || error.status !== 401 || epoch !== generation) throw error;
    // A late 401 reuses tokens already rotated by another request.
    if (!session?.accessToken || session.accessToken === accessToken) await waitForRefresh(options.signal);
    if (epoch !== generation) throw new ApiError(SESSION_ENDED, 401);
    try { return await send(path, options, session?.accessToken); }
    catch (retryError) { if (retryError.status === 401 && epoch === generation) endSession(); throw retryError; }
  }
}
export function restoreSession() {
  if (!bootPromise) bootPromise = (async () => {
    if (!session && !readRefresh()) return;
    if (!session) await refreshSession();
    const epoch = generation;
    const { user } = await request('/api/users/me');
    if (session && epoch === generation) publish({ ...session, user });
  })().finally(() => { bootPromise = null; });
  return bootPromise;
}
