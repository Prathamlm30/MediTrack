import s from './TextInput.module.css';
export default function TextInput({ error, className = '', ...props }) {
  return <input {...props} aria-invalid={error || props['aria-invalid'] || undefined} className={`${s.control} ${className}`} />;
}
