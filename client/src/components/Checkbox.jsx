import s from './Checkbox.module.css';
export default function Checkbox({ error, readOnly, className = '', onClick, ...props }) {
  return <input {...props} type="checkbox" readOnly={readOnly} aria-readonly={readOnly || undefined}
    aria-invalid={error || props['aria-invalid'] || undefined} onClick={(event) => { if (readOnly) event.preventDefault(); else onClick?.(event); }}
    onKeyDown={(event) => { if (readOnly && event.key !== 'Tab') event.preventDefault(); }} className={`${s.control} ${className}`} />;
}
