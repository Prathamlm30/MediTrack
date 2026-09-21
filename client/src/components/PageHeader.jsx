import s from './PageHeader.module.css';
export default function PageHeader({ title, description, action }) {
  return <header className={s.header}><div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</header>;
}
