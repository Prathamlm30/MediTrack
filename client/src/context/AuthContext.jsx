import { createContext, useCallback, useContext, useState } from 'react';

const AuthContext = createContext(null);
export function AuthProvider({ children }) {
  // Keep access tokens in memory; existing backend auth remains authoritative.
  const [session, setSession] = useState(null);
  const request = useCallback(async (path, options = {}) => {
    const response = await fetch(path, { ...options, headers: {
      ...options.headers, Authorization: `Bearer ${session?.accessToken || ''}`,
    } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }, [session?.accessToken]);
  return <AuthContext.Provider value={{ session, setSession, request }}>{children}</AuthContext.Provider>;
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth requires AuthProvider.');
  return context;
}
