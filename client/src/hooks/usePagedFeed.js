import { useCallback, useEffect, useRef, useState } from 'react';

// Refresh every loaded page atomically so revoked records also disappear from
// older pages. A failed append retries that cursor; a failed refresh keeps data.
export default function usePagedFeed(fetchPage, field, onResponse) {
  const [state, setState] = useState({ rows: null, nextCursor: null, busy: true });
  const pages = useRef(1);
  const pending = useRef(null);
  const failedCursor = useRef(null);
  const observer = useRef(onResponse); observer.current = onResponse;
  const load = useCallback(async (cursor = null) => {
    pending.current?.abort();
    const controller = new AbortController(); pending.current = controller;
    setState((old) => ({ ...old, busy: true, error: null }));
    try {
      let next = cursor, rows = [], response, count = 0;
      do {
        response = await fetchPage(next, { signal: controller.signal });
        if (controller.signal.aborted) return;
        rows.push(...response[field]); next = response.nextCursor; count++;
      } while (cursor == null && next != null && count < pages.current);
      pages.current = cursor == null ? count : pages.current + 1;
      failedCursor.current = null;
      observer.current?.(response);
      setState((old) => ({ rows: cursor == null ? rows : [...(old.rows || []), ...rows].filter((row, index, all) => all.findIndex((item) => item.id === row.id) === index), nextCursor: next, busy: false }));
    } catch (error) {
      if (controller.signal.aborted) return;
      failedCursor.current = cursor;
      setState((old) => ({ ...old, busy: false, error }));
    }
  }, [fetchPage, field]);
  useEffect(() => {
    void load();
    const refresh = () => { if (!pending.current || !stateBusy.current) void load(); };
    const interval = setInterval(refresh, 60000);
    window.addEventListener('focus', refresh);
    return () => { pending.current?.abort(); clearInterval(interval); window.removeEventListener('focus', refresh); };
  }, [load]);
  const stateBusy = useRef(state.busy); stateBusy.current = state.busy;
  const updateRows = (update) => { pending.current?.abort(); setState((old) => ({ ...old, rows: update(old.rows || []), busy: false })); };
  return { ...state, refresh: load, retry: () => load(failedCursor.current), loadMore: () => load(state.nextCursor), updateRows };
}
