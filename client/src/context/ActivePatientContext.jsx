import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getMyPatients } from '../api/dashboard.js';
import { useAuth } from './AuthContext.jsx';

const emptyPatients = [];
const ActivePatientContext = createContext(null);
export function ActivePatientProvider({ children }) {
  const { session, request } = useAuth();
  const [overview, setOverview] = useState(null);
  const [selection, setSelection] = useState(null);
  const [revision, setRevision] = useState(0);
  const token = session?.user?.id; // Selection belongs to the user, not a rotating access token.
  useEffect(() => {
    if (!token) { setOverview(null); setSelection(null); return; }
    let disposed = false;
    let controller;
    async function load() {
      controller?.abort();
      const pending = new AbortController(); controller = pending;
      try {
        const data = await getMyPatients({ signal: pending.signal });
        if (!disposed && !pending.signal.aborted) {
          setOverview({ token, patients: data.patients });
          setSelection((previous) => ({ token, id: data.patients.some((row) => row.patient.id === previous?.id && previous.token === token)
            ? previous.id : data.patients[0]?.patient.id ?? null }));
        }
      } catch (error) {
        if (!disposed && !pending.signal.aborted && error.name !== 'AbortError') setOverview((previous) => ({ token,
          patients: previous?.token === token ? previous.patients : [], error: error.message }));
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [token, request, revision]);
  const current = overview?.token === token ? overview : null;
  const patients = current?.patients || emptyPatients;
  const activePatient = patients.find((row) => selection?.token === token && row.patient.id === selection.id) || null;
  const setActivePatientId = useCallback((id) => {
    if (patients.some((row) => row.patient.id === Number(id))) setSelection((previous) => previous?.token === token && previous.id === Number(id) ? previous : { token, id: Number(id) });
  }, [patients, token]);
  const refreshPatients = useCallback(() => setRevision((value) => value + 1), []);
  return <ActivePatientContext.Provider value={{ patients, activePatient, activePatientId: activePatient?.patient.id ?? null,
    setActivePatientId, loading: Boolean(token && !current), error: current?.error,
    refreshPatients }}>{children}</ActivePatientContext.Provider>;
}
export function useActivePatient() {
  const context = useContext(ActivePatientContext);
  if (!context) throw new Error('useActivePatient requires ActivePatientProvider.');
  return context;
}
