import { shiftDate } from '../../jobs/adherenceCalendar.js';

// Calendar adjacency matters: two stored perfect rows separated by a missing
// date are two distinct streaks. Today's missing/incomplete row yields zero.
export function calculateStats(rows, today) {
  const daily = new Map(rows.filter((row) => row.periodStartDate.toISOString().slice(0, 10) <= today).map((row) => [row.periodStartDate.toISOString().slice(0, 10), row]));
  const perfect = (row) => row && row.totalScheduledDoses > 0 && row.takenCount === row.totalScheduledDoses;
  let currentStreak = 0;
  for (let day = today; perfect(daily.get(day)); day = shiftDate(day, -1)) currentStreak++;
  let bestStreak = 0, streak = 0, previous;
  for (const day of [...daily.keys()].sort()) {
    if (!previous || day !== shiftDate(previous, 1)) streak = 0;
    streak = perfect(daily.get(day)) ? streak + 1 : 0;
    bestStreak = Math.max(bestStreak, streak);
    previous = day;
  }
  const rolling = (days) => {
    let taken = 0, total = 0;
    const from = shiftDate(today, 1 - days);
    for (const [day, row] of daily) if (day >= from) { taken += row.takenCount; total += row.totalScheduledDoses; }
    return total ? Math.round(taken * 10000 / total) / 100 : 0;
  };
  return { currentStreak, bestStreak, rolling7DayPercentage: rolling(7), rolling30DayPercentage: rolling(30) };
}
