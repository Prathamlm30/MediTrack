import { CircleAlert } from 'lucide-react';
import Button from './Button.jsx';
import s from './ErrorState.module.css';
export default function ErrorState({ title = 'Could not load this information.', children, onRetry, loading }) {
  return <div className={s.error} role="alert"><CircleAlert size={18} strokeWidth={1.5} aria-hidden="true" /><h2>{title}</h2>
    {children && <p>{children}</p>}<Button variant="secondary" onClick={onRetry} loading={loading}>Retry</Button></div>;
}
