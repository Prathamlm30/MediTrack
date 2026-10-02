import { useEffect, useState } from 'react';
import { request } from '../../api/client.js';
import { inventoryChanged, useInventoryRevision } from '../../api/inventoryUpdates.js';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import { Details, useResource } from './Management.jsx';
import { inventoryUnits } from './medicineForm.js';
import s from './Management.module.css';

function InventoryForm({ medication, inventory, saved, cancel }) {
  const [draft, setDraft] = useState({ quantityTotal: '', refillThreshold: inventory?.refillThreshold ?? '', refillAmount: inventory?.refillAmount ?? '', estimatedUsagePerDose: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unit = inventoryUnits[medication.trackingType];
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('');
    const body = { refillThreshold: draft.refillThreshold, refillAmount: draft.refillAmount };
    if (!inventory) { body.quantityTotal = draft.quantityTotal; if (draft.estimatedUsagePerDose) body.estimatedUsagePerDose = draft.estimatedUsagePerDose; }
    try { await request(`/api/medications/${medication.id}/inventory`, { method: inventory ? 'PATCH' : 'POST', body }); inventoryChanged(medication.id); saved(); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  const fields = [...(!inventory ? [['quantityTotal', 'Starting quantity', 0]] : []), ['refillThreshold', 'Refill threshold', 0], ['refillAmount', 'Refill amount', 0.01], ...(!inventory && medication.trackingType !== 'countable' ? [['estimatedUsagePerDose', 'Estimated usage per dose', 0.01]] : [])];
  return <form onSubmit={submit} className={s.page}>{error && <Banner tone="danger">{error}</Banner>}<fieldset disabled={busy} className={s.card}><legend>{inventory ? 'Edit refill settings' : 'Set up inventory'}</legend><div className={s.fields}>{fields.map(([key, label, min]) => <Field key={key} label={`${label} (${unit})`} required><TextInput type="number" min={min} max={key === 'estimatedUsagePerDose' ? '9999.99' : '999999.99'} step="0.01" value={draft[key]} onChange={(e) => setDraft({ ...draft, [key]: e.target.value })} /></Field>)}</div><div className={s.actions}><Button type="submit" loading={busy}>{inventory ? 'Save refill settings' : 'Save inventory'}</Button>{cancel && <Button variant="secondary" onClick={cancel}>Cancel</Button>}</div></fieldset></form>;
}
export default function InventorySection({ medication, compact = false }) {
  const revision = useInventoryRevision(medication.id);
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({});
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    const controller = new AbortController(); setState({});
    request(`/api/medications/${medication.id}/inventory`, { signal: controller.signal }).then((data) => { if (!controller.signal.aborted) setState({ data }); }).catch((err) => { if (!controller.signal.aborted) setState(err.status === 404 ? { missing: true } : { error: err.message }); });
    return () => controller.abort();
  }, [medication.id, revision, retry]);
  const { data: notifications, error: notificationError } = useResource(`/api/medications/${medication.id}/inventory/notifications`, `${revision}:${retry}`);
  const unit = inventoryUnits[medication.trackingType];
  return <section className={s.card} aria-label={`Inventory for ${medication.medicineName}`}><h2>Medicine inventory{compact ? ` · ${medication.medicineName}` : ''}</h2>
    {state.error ? <Banner tone="danger">{state.error} <Button onClick={() => setRetry((v) => v + 1)}>Retry inventory</Button></Banner> : state.missing ? <><p>Inventory not set up.</p>{medication.canEdit && !compact && <InventoryForm medication={medication} saved={() => setRetry((v) => v + 1)} />}</> : !state.data ? <p role="status">Refreshing inventory…</p> : <>
      <p aria-live="polite"><strong>{state.data.quantityRemaining} {unit} remaining</strong> of {state.data.quantityTotal} {unit}</p>
      <p>Estimated runout: {state.data.estimatedRunoutDate?.slice(0, 10) || 'Not yet estimated'}</p>
      {Number(state.data.quantityRemaining) < Number(state.data.refillThreshold) && <Banner tone="warning">Stock is below the refill threshold.</Banner>}
      {!compact && <><h3>Refill reminder settings</h3><Details entries={[[`Refill threshold (${unit})`, state.data.refillThreshold], [`Refill amount (${unit})`, state.data.refillAmount]]} /><p>Runout estimates and refill notifications update during the daily inventory check.</p>
        {medication.canEdit && !editing && <Button variant="secondary" onClick={() => setEditing(true)}>Edit refill settings</Button>}
        {medication.canEdit && editing && <InventoryForm medication={medication} inventory={state.data} saved={() => setEditing(false)} cancel={() => setEditing(false)} />}
        <h3>Refill notifications</h3>{notificationError ? <Banner tone="danger">{notificationError}<Button onClick={() => setRetry((v) => v + 1)}>Retry notifications</Button></Banner> : !notifications ? <p>Loading notifications…</p> : notifications.length ? <ul>{notifications.map((row) => <li key={row.id}>{row.message} · {new Date(row.sentAt).toLocaleString()}</li>)}</ul> : <p>No refill notifications yet.</p>}</>}
    </>}
  </section>;
}
