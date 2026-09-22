import { useEffect, useId, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import Button from './Button.jsx';
import s from './Modal.module.css';
let openDialogs = 0;
let originalOverflow;
export default function Modal({ open, onClose, title, children, description, className = '' }) {
  const dialog = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement;
    const element = dialog.current;
    element.showModal();
    if (openDialogs++ === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      element.close();
      if (--openDialogs === 0) document.body.style.overflow = originalOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [open]);
  if (!open) return null;
  return createPortal(<dialog ref={dialog} className={`${s.modal} ${className}`} aria-labelledby={`${id}-title`}
    aria-describedby={description ? `${id}-description` : undefined} onCancel={(event) => { event.preventDefault(); closeRef.current(); }}
    onClick={(event) => {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.target === event.currentTarget && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) closeRef.current();
    }} onKeyDown={(event) => {
      if (event.key !== 'Tab') return;
      const items = [...dialog.current.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')].filter((item) => item.getClientRects().length);
      const first = items[0]; const last = items.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
    <header className={s.header}><h2 id={`${id}-title`}>{title}</h2><Button variant="ghost" aria-label="Close dialog" onClick={onClose}><X size={18} strokeWidth={1.5} aria-hidden="true" /></Button></header>
    {description && <p id={`${id}-description`}>{description}</p>}{children}
  </dialog>, document.body);
}
