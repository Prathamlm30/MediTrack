// IDs are opaque. Normalize only the URL/string representation, never parse IDs.
export function subscribeCoalesced(subscribe, resources, patientId, refetch, timers = globalThis) {
  let timer;
  const unsubscribe = subscribe((event) => {
    if (patientId == null || event?.patientId == null || String(event.patientId) !== String(patientId) || !resources.includes(event.resource)) return;
    timers.clearTimeout(timer);
    timer = timers.setTimeout(() => { timer = undefined; refetch(); }, 400);
  });
  return () => { timers.clearTimeout(timer); unsubscribe(); };
}
