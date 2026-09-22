import { useState } from 'react';
import { Check, CircleDot, Slash, Clock, Circle } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import { dayMinute, dayNumber, dosePeriod, formatDate, patientZone, quantity } from './dayTime.js';
import s from './DayRail.module.css';
const glyphs = { taken: Check, missed: CircleDot, skipped: Slash, snoozed: Clock, pending: Circle };
export default function DayRail({ doses = [], timezone, now = new Date(), animate = true }) {
  // Only markers present on mount join the entrance. Polls never replay it.
  const [entranceIds] = useState(() => new Map(animate ? doses.map((dose, index) => [dose.id, index]) : []));
  if (!doses.length) return <EmptyState title="No doses are scheduled for today.">Your scheduled doses will appear here.</EmptyState>;
  const ordered = [...doses].sort((a, b) => new Date(a.scheduledDatetime) - new Date(b.scheduledDatetime) || a.id - b.id);
  const occupied = [];
  const positions = ordered.map((dose) => dayMinute(dose.scheduledDatetime, timezone) / 1440 * 100);
  const lanes = positions.map((position) => {
    let lane = occupied.findIndex((previous) => position - previous >= 18);
    if (lane < 0) lane = occupied.length;
    occupied[lane] = position;
    return lane;
  });
  const zone = patientZone(timezone);
  const time = (value) => formatDate(value, zone, { hour: 'numeric', minute: '2-digit' });
  const sameDay = dayNumber(now, zone) === dayNumber(ordered[0].scheduledDatetime, zone);
  return <figure className={s.figure} aria-label={`Dose timeline in ${zone}`}>
    <div className={s.scroll}><div className={s.axis} style={{ '--lanes': occupied.length }}>
      {sameDay && <span className={s.now} style={{ '--position': `${dayMinute(now, zone) / 1440 * 100}%` }} aria-label={`Now, ${time(now)}`}><span>Now</span></span>}
      {ordered.map((dose, index) => {
        const medicine = dose.schedule.medication;
        const period = dosePeriod(dayMinute(dose.scheduledDatetime, zone));
        const Icon = glyphs[dose.status] || Circle;
        const label = `${time(dose.scheduledDatetime)}, ${medicine.medicineName} ${quantity(dose.schedule.doseAmount)} ${medicine.dosageUnit}, ${dose.status}`;
        return <span key={dose.id} className={`${s.point} ${s[period]}`} style={{ '--position': `${positions[index]}%`, '--lane': lanes[index], '--delay': `${(entranceIds.get(dose.id) || 0) * 40}ms` }}>
          <span className={s.segment} /><span className={s.stem} />
          <span tabIndex={0} role="img" aria-label={label} className={`${s.marker} ${s[dose.status]} ${entranceIds.has(dose.id) ? s.enter : ''}`}>
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" /><span aria-hidden="true" className={`${s.tooltip} ${positions[index] > 50 ? s.endTooltip : ''}`}>{label}</span>
          </span>
          <time className={s.caption} dateTime={dose.scheduledDatetime}>{time(dose.scheduledDatetime)}</time>
        </span>;
      })}
    </div></div><figcaption>Scheduled doses · {zone}. Focus a marker for medicine and status.</figcaption>
  </figure>;
}
