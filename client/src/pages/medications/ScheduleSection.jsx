import { useState } from 'react';
import { request } from '../../api/client.js';
import { inventoryChanged } from '../../api/inventoryUpdates.js';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import { useResource } from './Management.jsx';
import { inventoryUnits } from './medicineForm.js';
import { scheduleDraft, schedulePayload } from './scheduleForm.js';
import s from './Management.module.css';

const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function ScheduleRow({ row, medication, canEdit, saved, cancel }) {
  const [draft, setDraft] = useState(() => scheduleDraft(row));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const update = (key, value) => setDraft((old) => ({ ...old, [key]: value }));
  const unit = inventoryUnits[medication.trackingType];
  async function submit(event) {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await request(row ? `/api/schedules/${row.id}` : `/api/medications/${medication.id}/schedules`, { method: row ? 'PATCH' : 'POST', body: schedulePayload(draft) });
      inventoryChanged(medication.id); saved();
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  if (!canEdit) return <article className={s.card}><p>{draft.timeOfDay} · {draft.daysOfWeek.split(',').map((day) => days[day]).join(', ')} · {draft.isTaperSchedule ? 'Base dose: ' : ''}{draft.doseAmount} {unit} · {draft.isActive ? 'Active' : 'Inactive'}</p>{draft.isTaperSchedule && <><h3>Taper schedule</h3><p>The matching date-range step determines the dose.</p><ul>{draft.taperDetails.map((step, i) => <li key={i}>{step.fromDate} to {step.toDate}: {step.doseAmount} {unit}</li>)}</ul></>}</article>;
  return <form onSubmit={submit} className={s.card} aria-label={row ? `Schedule ${row.id}` : 'New schedule'}>
    {error && <Banner tone="danger">{error}</Banner>}
    <fieldset disabled={busy} className={s.page}><legend>{row ? 'Edit schedule' : 'Add schedule'}</legend>
      <div className={s.fields}><Field label="Reminder time" required><TextInput type="time" value={draft.timeOfDay} onChange={(e) => update('timeOfDay', e.target.value)} /></Field>
        <Field label={`Dose amount (${unit})`} required><TextInput type="number" min="0.01" max="9999.99" step="0.01" value={draft.doseAmount} onChange={(e) => update('doseAmount', e.target.value)} /></Field></div>
      <fieldset><legend>Days of week</legend><div className={s.actions}>{days.map((day, index) => <label key={day}><input type="checkbox" checked={draft.daysOfWeek.split(',').includes(String(index))} onChange={(e) => update('daysOfWeek', (e.target.checked ? [...draft.daysOfWeek.split(',').filter(Boolean), String(index)] : draft.daysOfWeek.split(',').filter((v) => v !== String(index))).sort().join(','))} /> {day}</label>)}</div></fieldset>
      <label><input type="checkbox" checked={draft.isActive} onChange={(e) => update('isActive', e.target.checked)} /> Active schedule</label>
      <label><input type="checkbox" checked={draft.isTaperSchedule} onChange={(e) => update('isTaperSchedule', e.target.checked)} /> Taper schedule</label>
      {draft.isTaperSchedule && <section className={s.page}><h3>Custom / taper schedule editor</h3><p>Date ranges are inclusive and must not overlap.</p>{draft.taperDetails.map((step, index) => <fieldset key={index} className={s.card}><legend>Step {index + 1}</legend><div className={s.fields}>{[['fromDate', 'From date', 'date'], ['toDate', 'To date', 'date'], ['doseAmount', `Step dose (${unit})`, 'number']].map(([key, label, type]) => <Field key={key} label={label} required><TextInput type={type} {...(type === 'number' && { min: '0.01', max: '9999.99', step: '0.01' })} value={step[key]} onChange={(e) => update('taperDetails', draft.taperDetails.map((v, i) => i === index ? { ...v, [key]: e.target.value } : v))} /></Field>)}</div><Button variant="secondary" onClick={() => update('taperDetails', draft.taperDetails.filter((_, i) => i !== index))}>Remove step {index + 1}</Button></fieldset>)}<Button variant="secondary" disabled={draft.taperDetails.length >= 100} onClick={() => update('taperDetails', [...draft.taperDetails, { fromDate: '', toDate: '', doseAmount: '1' }])}>Add taper step</Button></section>}
      <div className={s.actions}><Button type="submit" loading={busy}>Save schedule</Button>{cancel && <Button variant="secondary" onClick={cancel}>Cancel</Button>}</div>
    </fieldset>
  </form>;
}
export default function ScheduleSection({ medication }) {
  const [revision, setRevision] = useState(0);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const { data, error } = useResource(`/api/medications/${medication.id}/schedules`, revision);
  const saved = () => { setAdding(false); setRevision((v) => v + 1); };
  async function generate() {
    setBusy(true); setFailure('');
    try { await request(`/api/medications/${medication.id}/schedules/generate`, { method: 'POST', body: { frequencyText: medication.frequencyText } }); saved(); }
    catch (err) { setFailure(err.message); } finally { setBusy(false); }
  }
  return <section className={s.card}><h2>Reminder schedule setup</h2><p>Reminder times use the patient's timezone. Review generated times before relying on reminders.</p>
    {(error || failure) && <Banner tone="danger">{error || failure} <Button onClick={saved}>Reload schedules</Button></Banner>}
    {!data ? !error && <p role="status">Loading schedules…</p> : <>{!data.length && <p>No schedules yet.</p>}{data.map((row) => <ScheduleRow key={`${row.id}:${revision}`} row={row} medication={medication} canEdit={medication.canEdit} saved={saved} />)}
      {medication.canEdit && <div className={s.actions}>{!data.length && <Button loading={busy} onClick={generate}>Generate from frequency text</Button>}<Button variant="secondary" disabled={busy || adding} onClick={() => setAdding(true)}>Add schedule manually</Button></div>}
      {adding && medication.canEdit && <ScheduleRow medication={medication} canEdit saved={saved} cancel={() => setAdding(false)} />}</>}
  </section>;
}
