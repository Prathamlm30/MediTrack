import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { getNotifications } from '../api/notifications.js';
import { useAuth } from './AuthContext.jsx';
import { useSocket } from './SocketContext.jsx';

const NotificationContext = createContext(null);
function InboxCount({ children }) {
  const [count, setCount] = useState(null);
  const pending = useRef(null);
  const { socket } = useSocket();
  const refreshCount = useCallback(async () => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    try {
      const data = await getNotifications({ limit: 1 }, { signal: controller.signal });
      if (!controller.signal.aborted) setCount(data.unreadCount);
    } catch { /* Keep the last known count; the inbox exposes errors and Retry. */ }
  }, []);
  const acceptCount = useCallback((value) => { pending.current?.abort(); setCount(value); }, []);
  useEffect(() => {
    void refreshCount();
    const interval = setInterval(refreshCount, 60000);
    window.addEventListener('focus', refreshCount);
    socket?.on('dose-reminder', refreshCount);
    socket?.on('missed-dose-alert', refreshCount);
    socket?.on('connect', refreshCount);
    return () => {
      pending.current?.abort(); clearInterval(interval); window.removeEventListener('focus', refreshCount);
      socket?.off('dose-reminder', refreshCount); socket?.off('missed-dose-alert', refreshCount); socket?.off('connect', refreshCount);
    };
  }, [socket, refreshCount]);
  return <NotificationContext.Provider value={{ count, acceptCount, refreshCount }}>{children}</NotificationContext.Provider>;
}
export function NotificationProvider({ children }) {
  const { session } = useAuth();
  return session?.user ? <InboxCount key={session.user.id}>{children}</InboxCount> : children;
}
export const useNotifications = () => useContext(NotificationContext);
