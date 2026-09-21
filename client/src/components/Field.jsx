import { cloneElement, useId } from 'react';
import s from './Field.module.css';
export default function Field({ label, help, error, required, children, id }) {
  const generated = useId();
  const inputId = id || children.props.id || generated;
  const describedBy = [children.props['aria-describedby'], help && `${inputId}-help`, error && `${inputId}-error`].filter(Boolean).join(' ') || undefined;
  return <div className={s.field}><label htmlFor={inputId}>{label}{required && <span aria-label="required"> *</span>}</label>
    {cloneElement(children, { id: inputId, required, error: Boolean(error), 'aria-invalid': error ? true : undefined, 'aria-describedby': describedBy })}
    {help && <p id={`${inputId}-help`} className={s.help}>{help}</p>}
    {error && <p id={`${inputId}-error`} className={s.error} role="alert">{error}</p>}
  </div>;
}
