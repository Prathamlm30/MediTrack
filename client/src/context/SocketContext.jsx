import { createContext, useContext, useEffect, useState } from 'react';
import { io } from 'socket.io-client';
import { API_BASE_URL, getSession, refreshSession } from '../api/client.js';
import { useAuth } from './AuthContext.jsx';
import { useActivePatient } from './ActivePatientContext.jsx';
import { useToast } from '../components/Toast.jsx';

const SocketContext = createContext({ socket: null, status: 'Connecting for live updates…' });

// One authenticated connection for alerts, adherence, and scan review. Route
// consumers only add/remove listeners; this provider owns its lifetime.
function SessionSocket({ session, children }) {
  const [socket] = useState(() => io(API_BASE_URL, { autoConnect: false }));
  const [status, setStatus] = useState('Connecting for live updates…');
  const { patients } = useActivePatient();
  const notify = useToast();
  useEffect(() => {
    let live = true;
    let refreshed = false;
    const connected = () => setStatus('Live updates connected.');
    const disconnected = () => setStatus('Connection lost. Reconnecting…');
    const failed = async (error) => {
      setStatus('Live updates unavailable. Use Refresh to check for changes.');
      if (error.message === 'Authentication required.' && !refreshed) {
        refreshed = true;
        try {
          await refreshSession(); // Shares the API client's single token rotation.
          if (live) { socket.auth = { token: getSession()?.accessToken }; socket.connect(); }
        } catch { /* AuthProvider handles an expired session. */ }
      }
    };
    socket.auth = { token: session.accessToken };
    socket.on('connect', connected);
    socket.on('disconnect', disconnected);
    socket.on('connect_error', failed);
    socket.connect();
    return () => {
      live = false;
      socket.off('connect', connected);
      socket.off('disconnect', disconnected);
      socket.off('connect_error', failed);
      socket.disconnect();
    };
  }, [socket, session.accessToken]);
  useEffect(() => {
    const missed = (event) => {
      const patient = patients.find((row) => row.patient.id === event.patientId)?.patient;
      notify(`Missed dose alert${patient ? ` for ${patient.fullName}` : ''}: ${event.medicineName}. Open Alerts to review.`, 'info');
    };
    socket.on('missed-dose-alert', missed);
    return () => socket.off('missed-dose-alert', missed);
  }, [socket, patients, notify]);
  return <SocketContext.Provider value={{ socket, status }}>{children}</SocketContext.Provider>;
}

export function SocketProvider({ children }) {
  const { session } = useAuth();
  return session?.user ? <SessionSocket key={session.user.id} session={session}>{children}</SessionSocket> : children;
}
export function useSocket() { return useContext(SocketContext); }
