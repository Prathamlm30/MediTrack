import { Check, CircleDot, Slash, Clock, Circle } from 'lucide-react';
import EmptyState from './EmptyState.jsx';
import s from './DayRail.module.css';
const glyphs = { taken: Check, missed: CircleDot, skipped: Slash, snoozed: Clock, pending: Circle };
export default function DayRail({ doses = [], timezone, now = new Date() }) {
  if (!doses.length) return <EmptyState title="No doses are scheduled for today.">Your scheduled doses will appear here.</EmptyState>;
  const ordered = [...doses].sort((a, b) => new Date(a.scheduledDatetime) - new Date(b.scheduledDatetime));
  const times = ordered.map((dose) => new Date(dose.scheduledDatetime).getTime());
  const start = times[0]; const end = times.at(-1);
  const fraction = (value) => end === start ? 50 : (value - start) / (end - start) * 100;
  const position = (value) => `${fraction(value)}%`;
  const occupied = [];
  const lanes = times.map((value) => {
    const x = fraction(value);
    let lane = occupied.findIndex((previous) => x - previous >= 18);
    if (lane < 0) lane = occupied.length;
    occupied[lane] = x;
    return lane;
  });
  const resolvedTimezone = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const format = new Intl.DateTimeFormat(undefined, { timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, hour: 'numeric', minute: '2-digit' });
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: timezone || Intl.DateTimeFormat().resolvedOptions().timeZone, hour: 'numeric', hourCycle: 'h23' });
  const current = new Date(now).getTime();
  return <figure className={s.figure} aria-label={`Dose timeline in ${resolvedTimezone}`}>
    <div className={s.axis} style={{ '--lanes': occupied.length }}>
      {current >= start && current <= end && <span className={s.now} style={{ '--position': position(current) }}><span>Now</span></span>}
      {ordered.map((dose, index) => {
        const date = new Date(dose.scheduledDatetime); const medicine = dose.schedule.medication;
        const h = Number(hour.format(date)); const period = h < 12 && h >= 5 ? 'morning' : h < 17 && h >= 12 ? 'midday' : h >= 17 && h < 21 ? 'evening' : 'night';
        const Icon = glyphs[dose.status] || Circle;
        const label = `${format.format(date)}, ${medicine.medicineName} ${dose.schedule.doseAmount} ${medicine.dosageUnit}, ${dose.status}`;
        return <span key={dose.id} className={`${s.point} ${s[period]}`} style={{ '--position': position(times[index]), '--lane': lanes[index] }}>
          <span className={s.segment} /><span tabIndex={0} role="img" aria-label={label} className={`${s.marker} ${s[dose.status]}`}>
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" /><span className={s.tooltip}>{label}</span></span>
          <span className={s.caption}><time dateTime={date.toISOString()}>{format.format(date)}</time><span>{medicine.medicineName}</span></span>
        </span>;
      })}
    </div><figcaption>Scheduled doses · {resolvedTimezone}</figcaption>
  </figure>;
}
