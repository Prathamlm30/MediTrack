import s from './Skeleton.module.css';
export default function Skeleton({ height = 'var(--s10)', width = '100%', label = 'Loading content' }) {
  return <div className={s.skeleton} role="status" aria-label={label} style={{ height, width }} />;
}
