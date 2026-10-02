export function scheduleDraft(row) {
  return {
    timeOfDay: row?.timeOfDay?.includes('T') ? row.timeOfDay.slice(11, 16) : row?.timeOfDay || '08:00',
    daysOfWeek: row?.daysOfWeek ?? '0,1,2,3,4,5,6',
    doseAmount: row?.doseAmount ?? '1', isActive: row?.isActive ?? true,
    isTaperSchedule: row?.isTaperSchedule ?? false,
    taperDetails: row?.taperDetails?.map((step) => ({ ...step })) ?? [],
  };
}
export function schedulePayload(draft) {
  if (!draft.daysOfWeek) throw new Error('Select at least one day.');
  const taperDetails = draft.isTaperSchedule ? draft.taperDetails.map((step) => ({ ...step, doseAmount: Number(step.doseAmount) })) : null;
  if (taperDetails) {
    if (!taperDetails.length || taperDetails.length > 100) throw new Error('A taper requires 1–100 steps.');
    const sorted = [...taperDetails].sort((a, b) => a.fromDate.localeCompare(b.fromDate));
    for (const [i, step] of sorted.entries()) {
      if (!step.fromDate || !step.toDate || step.toDate < step.fromDate) throw new Error('Each taper step needs a start date and an end date on or after its start.');
      if (!(step.doseAmount > 0)) throw new Error('Each taper dose must be positive.');
      if (i && step.fromDate <= sorted[i - 1].toDate) throw new Error('Taper steps cannot overlap. Start and end dates are inclusive.');
    }
  }
  return { ...draft, doseAmount: Number(draft.doseAmount), taperDetails };
}
