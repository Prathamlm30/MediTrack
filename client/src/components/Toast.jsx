import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { CheckCircle, Info, CircleAlert, X } from 'lucide-react';
import s from './Toast.module.css';
const ToastContext = createContext(null);
let nextId = 0;
export function Toast({ tone = 'info', children, onDismiss }) {
  useEffect(() => { const timer = setTimeout(onDismiss, 5000); return () => clearTimeout(timer); }, [onDismiss]);
  const Icon = { success: CheckCircle, error: CircleAlert, info: Info }[tone];
  return <div className={`${s.toast} ${s[tone]}`} role="status" aria-live="polite"><Icon size={18} strokeWidth={1.5} aria-hidden="true" />
    <span>{children}</span><button onClick={onDismiss} aria-label="Dismiss notification"><X size={16} strokeWidth={1.5} aria-hidden="true" /></button></div>;
}
function ToastItem({ item, dismiss }) {
  const close = useCallback(() => dismiss(item.id), [dismiss, item.id]);
  return <Toast tone={item.tone} onDismiss={close}>{item.message}</Toast>;
}
export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const notify = useCallback((message, tone = 'info') => setItems((previous) => [...previous, { id: ++nextId, message, tone }].slice(-3)), []);
  const dismiss = useCallback((id) => setItems((previous) => previous.filter((item) => item.id !== id)), []);
  return <ToastContext.Provider value={notify}>{children}<div className={s.stack} role="region" aria-label="Notifications">{items.map((item) => <ToastItem key={item.id} item={item} dismiss={dismiss} />)}</div></ToastContext.Provider>;
}
export function useToast() { const context = useContext(ToastContext); if (!context) throw new Error('useToast requires ToastProvider.'); return context; }
