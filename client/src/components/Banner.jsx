import { Info, TriangleAlert, CircleAlert } from 'lucide-react';
import s from './Banner.module.css';
export default function Banner({ tone = 'info', children }) {
  const Icon = { info: Info, warning: TriangleAlert, danger: CircleAlert }[tone];
  return <div className={`${s.banner} ${s[tone]}`} role={tone === 'danger' ? 'alert' : 'status'}><Icon size={18} strokeWidth={1.5} aria-hidden="true" /><div>{children}</div></div>;
}
