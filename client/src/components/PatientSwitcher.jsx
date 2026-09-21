import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import Button from './Button.jsx';
import Modal from './Modal.jsx';
import s from './PatientSwitcher.module.css';
export default function PatientSwitcher({ patients, activePatientId, onChange, loading = false, error }) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => matchMedia('(max-width: 767px)').matches);
  const root = useRef(null); const trigger = useRef(null); const menu = useRef(null); const id = useId();
  const active = patients.find((row) => row.patient.id === Number(activePatientId));
  useEffect(() => {
    const query = matchMedia('(max-width: 767px)'); const update = () => { setMobile(query.matches); setOpen(false); };
    query.addEventListener('change', update); return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open || mobile) return;
    menu.current?.querySelector('[aria-checked="true"]')?.focus();
    if (!menu.current?.contains(document.activeElement)) menu.current?.querySelector('button')?.focus();
    const outside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    document.addEventListener('pointerdown', outside); return () => document.removeEventListener('pointerdown', outside);
  }, [open, mobile]);
  function close() { setOpen(false); trigger.current?.focus(); }
  function keyDown(event) {
    const buttons = [...event.currentTarget.querySelectorAll('button')];
    const index = buttons.indexOf(document.activeElement);
    const next = { ArrowDown: (index + 1) % buttons.length, ArrowUp: (index - 1 + buttons.length) % buttons.length, Home: 0, End: buttons.length - 1 }[event.key];
    if (next != null) { event.preventDefault(); buttons[next]?.focus(); }
    if (event.key === 'Escape') { event.preventDefault(); close(); }
    if (event.key === 'Tab' && !mobile) close();
  }
  const choices = <div id={id} ref={menu} role="menu" aria-label="Active patient" onKeyDown={keyDown} className={s.choices}>
    {patients.map(({ patient }) => <button key={patient.id} role="menuitemradio" aria-checked={patient.id === Number(activePatientId)}
      onClick={() => { onChange(patient.id); close(); }}>{patient.fullName}{patient.id === Number(activePatientId) && <Check size={16} strokeWidth={1.5} aria-hidden="true" />}</button>)}
  </div>;
  return <div className={s.switcher} ref={root}><Button ref={trigger} variant="secondary" disabled={loading || !patients.length}
    aria-haspopup={mobile ? 'dialog' : 'menu'} aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
    {loading ? 'Loading patients…' : active?.patient.fullName || 'Choose patient'} <ChevronDown size={16} strokeWidth={1.5} aria-hidden="true" /></Button>
    {error && <p role="alert">{error}</p>}{!loading && !error && !patients.length && <p>No active linked patients.</p>}
    {open && (mobile ? <Modal open onClose={close} title="Choose patient" className={s.sheet}>{choices}</Modal> : <div className={s.menu}>{choices}</div>)}
  </div>;
}
