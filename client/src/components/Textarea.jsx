import s from './Textarea.module.css';
export default function Textarea({ error, className = '', ...props }) {
  return <textarea {...props} aria-invalid={error || props['aria-invalid'] || undefined} className={`${s.control} ${className}`} />;
}
