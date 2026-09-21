import { useId, useRef } from 'react';
import s from './Tabs.module.css';
export default function Tabs({ items, value, onChange, label = 'Sections', children }) {
  const id = useId(); const refs = useRef([]);
  const selected = items.findIndex((item) => item.value === value);
  function keyDown(event, index) {
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % items.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = items.length - 1;
    if (next != null) { event.preventDefault(); onChange(items[next].value); refs.current[next].focus(); }
  }
  return <div><div className={s.tabs} role="tablist" aria-label={label}>{items.map((item, index) => <button key={item.value}
    ref={(node) => { refs.current[index] = node; }} role="tab" id={`${id}-${index}`} aria-controls={`${id}-panel-${index}`}
    aria-selected={item.value === value} tabIndex={item.value === value ? 0 : -1} onClick={() => onChange(item.value)}
    onKeyDown={(event) => keyDown(event, index)}>{item.label}</button>)}</div>
    {items.map((item, index) => <div key={item.value} id={`${id}-panel-${index}`} role="tabpanel" tabIndex={0} hidden={index !== selected}
      aria-labelledby={`${id}-${index}`} className={s.panel}>{index === selected && children}</div>)}</div>;
}
