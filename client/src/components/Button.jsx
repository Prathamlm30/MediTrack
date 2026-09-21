import s from './Button.module.css';
export default function Button({ variant = 'primary', size = 'md', loading = false, disabled, children, className = '', ...props }) {
  return <button type="button" {...props} disabled={disabled || loading} aria-busy={loading || undefined}
    className={`${s.button} ${s[variant]} ${s[size]} ${className}`}>
    <span className={loading ? s.hidden : undefined}>{children}</span>
    {loading && <span className={s.spinner} aria-hidden="true" />}
  </button>;
}
