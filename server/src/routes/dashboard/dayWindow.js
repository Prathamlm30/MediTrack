// Calendar-day boundaries in the patient's timezone, including 23/25-hour DST days.
export function dayWindow(now = new Date(), requestedTimezone = 'UTC') {
  let formatter;
  let timezone = requestedTimezone || 'UTC';
  try {
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  } catch {
    timezone = 'UTC';
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' });
  }
  const dateKey = (time) => {
    const parts = Object.fromEntries(formatter.formatToParts(time).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
  };
  const today = dateKey(now);
  const boundary = (afterToday) => {
    let low = now.getTime() - 48 * 3600000;
    let high = now.getTime() + 48 * 3600000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const key = dateKey(middle);
      if (afterToday ? key > today : key >= today) high = middle;
      else low = middle + 1;
    }
    return new Date(low);
  };
  return { timezone, start: boundary(false), end: boundary(true) };
}
