import s from './EmptyState.module.css';
export default function EmptyState({ title, children, action }) {
  return <section className={s.empty}><h2>{title}</h2><p>{children}</p>{action && <div>{action}</div>}</section>;
}
