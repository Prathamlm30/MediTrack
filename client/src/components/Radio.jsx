import s from './Radio.module.css';
export default function Radio({ error, readOnly, className = '', onClick, ...props }) {
  return <input {...props} type="radio" readOnly={readOnly} aria-disabled={readOnly || props.disabled || undefined}
    aria-invalid={error || props['aria-invalid'] || undefined} onClick={(event) => { if (readOnly) event.preventDefault(); else onClick?.(event); }}
    onKeyDown={(event) => { if (readOnly && event.key !== 'Tab') event.preventDefault(); }} className={`${s.control} ${className}`} />;
}
