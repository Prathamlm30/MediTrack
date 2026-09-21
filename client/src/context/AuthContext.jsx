import { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { getSession, subscribeSession, setSession, request, restoreSession } from '../api/client.js';
import * as auth from '../api/auth.js';
import { updatePreferences } from '../api/users.js';
const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  const session = useSyncExternalStore(subscribeSession, getSession, () => null);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    restoreSession().catch((err) => { if (live) setError(err.message); }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, []);
  useEffect(() => {
    const theme = session?.user?.preferences?.theme;
    if (theme === 'dark' || theme === 'light') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
  }, [session?.user?.preferences?.theme]);
  async function retrySession() {
    setChecking(true); setError('');
    try { await restoreSession(); } catch (err) { setError(err.message); } finally { setChecking(false); }
  }
  async function signOut() { await auth.logout(); setSession(null); }
  async function setTheme(theme) {
    const { preferences } = await updatePreferences({ theme });
    const current = getSession();
    if (current) setSession({ ...current, user: { ...current.user, preferences } });
  }
  return <AuthContext.Provider value={{ session, setSession, request, checking, error, retrySession, signOut, setTheme }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider.');
  return context;
}
