import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import s from './PasswordInput.module.css';
export default function PasswordInput({ error, className = '', ...props }) {
  const [visible, setVisible] = useState(false);
  const Icon = visible ? EyeOff : Eye;
  return <div className={s.wrapper}><input {...props} type={visible ? 'text' : 'password'}
    aria-invalid={error || props['aria-invalid'] || undefined} className={`${s.control} ${className}`} />
    <button type="button" disabled={props.disabled} className={s.toggle} aria-label={visible ? 'Hide password' : 'Show password'}
      aria-pressed={visible} onClick={() => setVisible(!visible)}><Icon size={18} strokeWidth={1.5} aria-hidden="true" /></button></div>;
}
