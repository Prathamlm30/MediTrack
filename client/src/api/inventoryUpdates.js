import { useEffect, useState } from 'react';

const listeners = new Set();
const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel('meditrack-inventory');
function notify(id) { listeners.forEach((listener) => listener(String(id))); }
if (channel) channel.onmessage = (event) => notify(event.data);
export function inventoryChanged(id) { notify(id); channel?.postMessage(String(id)); }
export function useInventoryRevision(id) {
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const listener = (changed) => { if (changed === String(id)) setRevision((value) => value + 1); };
    const refresh = () => setRevision((value) => value + 1);
    listeners.add(listener);
    window.addEventListener('focus', refresh);
    return () => { listeners.delete(listener); window.removeEventListener('focus', refresh); };
  }, [id]);
  return revision;
}
