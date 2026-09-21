import s from './Card.module.css';
export default function Card({ title, action, children, className = '' }) {
  return <section className={`${s.card} ${className}`}>{(title || action) && <header className={s.header}>{title && <h2>{title}</h2>}{action}</header>}{children}</section>;
}
