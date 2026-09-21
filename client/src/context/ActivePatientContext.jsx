import { createContext, useContext, useEffect, useState } from 'react';
import { useAuth } from './AuthContext.jsx';

const ActivePatientContext = createContext(null);
export function ActivePatientProvider({ children }) {
  const { session, request } = useAuth();
  const [overview, setOverview] = useState(null);
  const [selection, setSelection] = useState(null);
  const [revision, setRevision] = useState(0);
  const token = session?.accessToken;
  useEffect(() => {
    if (!token) { setOverview(null); setSelection(null); return; }
    let disposed = false;
    let controller;
    async function load() {
      controller?.abort();
      controller = new AbortController();
      try {
        const data = await request('/api/dashboard/my-patients', { signal: controller.signal });
        if (!disposed) {
          setOverview({ token, patients: data.patients });
          setSelection((previous) => ({ token, id: data.patients.some((row) => row.patient.id === previous?.id && previous.token === token)
            ? previous.id : data.patients[0]?.patient.id ?? null }));
        }
      } catch (error) {
        if (!disposed && error.name !== 'AbortError') setOverview({ token, patients: [], error: error.message });
      }
    }
    void load();
    const interval = setInterval(load, 30000);
    window.addEventListener('focus', load);
    return () => { disposed = true; controller?.abort(); clearInterval(interval); window.removeEventListener('focus', load); };
  }, [token, request, revision]);
  const current = overview?.token === token ? overview : null;
  const patients = current?.patients || [];
  const activePatient = patients.find((row) => selection?.token === token && row.patient.id === selection.id) || null;
  const setActivePatientId = (id) => {
    if (patients.some((row) => row.patient.id === Number(id))) setSelection({ token, id: Number(id) });
  };
  return <ActivePatientContext.Provider value={{ patients, activePatient, activePatientId: activePatient?.patient.id ?? null,
    setActivePatientId, loading: Boolean(token && !current), error: current?.error,
    refreshPatients: () => setRevision((value) => value + 1) }}>{children}</ActivePatientContext.Provider>;
}
export function useActivePatient() {
  const context = useContext(ActivePatientContext);
  if (!context) throw new Error('useActivePatient requires ActivePatientProvider.');
  return context;
}
