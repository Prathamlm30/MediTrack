import { CircleAlert } from 'lucide-react';
import Button from './Button.jsx';
import s from './ErrorState.module.css';
export default function ErrorState({ title = 'Could not load this information.', children, onRetry, loading, headingLevel = 2 }) {
  const Heading = headingLevel ? `h${headingLevel}` : 'p';
  return <div className={s.error} role="alert"><CircleAlert size={18} strokeWidth={1.5} aria-hidden="true" /><Heading>{title}</Heading>
    {children && <p>{children}</p>}{onRetry && <Button variant="secondary" onClick={onRetry} loading={loading}>Retry</Button>}</div>;
}
