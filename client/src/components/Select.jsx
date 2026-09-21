import s from './Select.module.css';
export default function Select({ error, readOnly, className = '', onChange, children, ...props }) {
  return <select {...props} aria-readonly={readOnly || undefined} aria-invalid={error || props['aria-invalid'] || undefined}
    onChange={(event) => { if (!readOnly) onChange?.(event); }}
    onKeyDown={(event) => { if (readOnly && event.key !== 'Tab') event.preventDefault(); }}
    onMouseDown={(event) => { if (readOnly) { event.preventDefault(); event.currentTarget.focus(); } }}
    className={`${s.control} ${className}`}>{children}</select>;
}
