import { useLayoutEffect, useState } from 'react';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';
import Select from '../../components/Select.jsx';
import Textarea from '../../components/Textarea.jsx';
import Checkbox from '../../components/Checkbox.jsx';
import Radio from '../../components/Radio.jsx';
import Card from '../../components/Card.jsx';
import StatusPill, { statusDefinitions } from '../../components/StatusPill.jsx';
import Avatar from '../../components/Avatar.jsx';
import Modal from '../../components/Modal.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { Toast, useToast } from '../../components/Toast.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Banner from '../../components/Banner.jsx';
import Tabs from '../../components/Tabs.jsx';
import PatientSwitcher from '../../components/PatientSwitcher.jsx';
import DayRail from '../../components/DayRail.jsx';
import s from './DevUI.module.css';
const patients = [{ patient: { id: 1, fullName: 'Asha Rao' } }, { patient: { id: 2, fullName: 'Ravi Rao' } }];
const doses = ['taken', 'missed', 'skipped', 'snoozed', 'pending'].map((status, index) => ({
  id: index, status, scheduledDatetime: `2026-09-21T${['08:00', '12:00', '16:00', '20:00', '23:30'][index]}:00+05:30`,
  schedule: { doseAmount: 1, medication: { medicineName: `Example ${index + 1}`, dosageUnit: 'tablet' } },
}));
const midnightDoses = [
  { ...doses[4], id: 'late', scheduledDatetime: '2026-09-21T23:30:00+05:30' },
  { ...doses[0], id: 'midnight', scheduledDatetime: '2026-09-21T00:00:00+05:30' },
];
function Gallery({ theme }) {
  const [dialog, setDialog] = useState(null); const [tab, setTab] = useState('first'); const [patient, setPatient] = useState(1);
  const [count, setCount] = useState(0); const [retry, setRetry] = useState(0); const [toasts, setToasts] = useState(['success', 'error', 'info']);
  const notify = useToast();
  const [avatarUrl, setAvatarUrl] = useState(null);
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme;
    const tokens = getComputedStyle(document.documentElement);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="${tokens.getPropertyValue('--brand-tint').trim()}"/><g fill="${tokens.getPropertyValue('--brand').trim()}"><circle cx="20" cy="14" r="7"/><path d="M7 40v-7a13 13 0 0 1 26 0v7Z"/></g></svg>`;
    setAvatarUrl(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  }, [theme]);
  const click = () => setCount((value) => value + 1);
  return <main className={s.gallery}>
    <PageHeader title={`${theme === 'dark' ? 'Dark' : 'Light'} component gallery`} description="Interactive foundation states. All data here is fictional." action={<Button variant="secondary" onClick={() => window.scrollTo({ top: 0 })}>Back to top</Button>} />
    <Banner>Preview theme only; this page never changes your saved preference.</Banner>
    <Card title="Buttons"><p role="status">Demo actions: <span className="tabular-nums">{count}</span></p>
      {['primary', 'secondary', 'ghost', 'danger'].map((variant) => <section key={variant} className={s.group}><h3>{variant}</h3>
        {['sm', 'md'].map((size) => <div key={size} className={s.row}>{['default', 'hover', 'active', 'focus-visible', 'disabled', 'loading'].map((state) =>
          <div key={state} className={s.sample}><span>{size} · {state}</span><Button variant={variant} size={size} data-preview={state}
            disabled={state === 'disabled'} loading={state === 'loading'} onClick={click}>Save example</Button></div>)}</div>)}
      </section>)}
    </Card>
    <Card title="Form controls"><div className={s.controls}>
      {[['Text input', TextInput], ['Password input', PasswordInput], ['Select', Select], ['Textarea', Textarea], ['Checkbox', Checkbox], ['Radio', Radio]].map(([name, Control]) =>
        ['default', 'focus', 'error', 'disabled', 'read-only'].map((state) => <Field key={`${name}-${state}`} label={`${name} · ${state}`} required={state === 'default'}
          help={state === 'default' ? 'Optional help explains this field.' : undefined} error={state === 'error' ? 'Check this example value.' : undefined}>
          <Control data-preview={state} disabled={state === 'disabled'} readOnly={state === 'read-only'}
            {...(name === 'Checkbox' || name === 'Radio' ? { defaultChecked: state === 'read-only' } : { defaultValue: name === 'Select' ? 'one' : 'Example value' })}>
            {name === 'Select' ? <><option value="one">First option</option><option value="two">Second option</option></> : undefined}
          </Control></Field>))}
    </div></Card>
    <Card title="Cards and headers" action={<Button size="sm" onClick={click}>Example action</Button>}>
      <Card>Card without a header.</Card><PageHeader title="Header without extras" />
      <PageHeader title="Header with description" description="A short one-line description." />
    </Card>
    <Card title="Status pills"><div className={s.row}>{Object.keys(statusDefinitions).map((status) => <StatusPill key={status} status={status} />)}</div></Card>
    <Card title="Avatars"><div className={s.row}><Avatar fullName="Asha Rao" /><Avatar fullName="Image example" profilePictureUrl={avatarUrl} />
      <Avatar fullName="Fallback example" /></div></Card>
    <Card title="Dialogs"><div className={s.row}><Button onClick={() => setDialog('modal')}>Open modal</Button>
      <Button variant="secondary" onClick={() => setDialog('confirm')}>Open confirmation</Button><Button variant="danger" onClick={() => setDialog('danger')}>Open destructive confirmation</Button></div>
      <p>Closed by default. Test Tab, Shift+Tab, Escape, backdrop click, and focus restoration.</p>
    </Card>
    <Modal open={dialog === 'modal'} onClose={() => setDialog(null)} title="Example modal" description="Focus stays inside this dialog until it closes.">
      <Field label="Example name"><TextInput defaultValue="Asha" /></Field><Button onClick={() => setDialog(null)}>Done</Button>
    </Modal>
    <ConfirmDialog open={dialog === 'confirm' || dialog === 'danger'} onClose={() => setDialog(null)}
      title={dialog === 'danger' ? 'Remove example?' : 'Apply example?'} consequence={dialog === 'danger' ? 'This removes the fictional example from this preview only.' : 'This increments the example counter.'}
      destructive={dialog === 'danger'} confirmLabel={dialog === 'danger' ? 'Remove example' : 'Apply example'} onConfirm={() => { click(); setDialog(null); }} />
    <Card title="Toasts"><div className={s.row}>{['success', 'error', 'info'].map((tone) => <Button key={tone} variant="secondary" onClick={() => notify(`${tone} example notification`, tone)}>Show {tone} toast</Button>)}
      <Button variant="ghost" onClick={() => setToasts(['success', 'error', 'info'])}>Replay inline examples</Button></div>
      <div className={s.group}>{toasts.map((tone) => <Toast key={tone} tone={tone} onDismiss={() => setToasts((previous) => previous.filter((item) => item !== tone))}>{tone} example. Dismisses after five seconds.</Toast>)}</div>
    </Card>
    <EmptyState title="Nothing here yet.">Your information will appear in this space.</EmptyState>
    <EmptyState title="Try an example." action={<Button onClick={click}>Add example</Button>}>Use one action to get started.</EmptyState>
    <ErrorState onRetry={() => setRetry((value) => value + 1)}>Example load failed. Retry attempts: {retry}.</ErrorState>
    <Card title="Loading skeletons"><Skeleton height="calc(var(--s10) * 2)" label="Loading card" /><div className={s.group}>{[1, 2, 3].map((id) => <Skeleton key={id} height="var(--s9)" label="Loading list row" />)}</div></Card>
    <Card title="Banners"><div className={s.group}>{['info', 'warning', 'danger'].map((tone) => <Banner key={tone} tone={tone}>{tone === 'info' ? 'Read-only example. Changes are managed by the patient.' : tone === 'warning' ? 'Check this information before continuing.' : 'The example could not be saved. Try again.'}</Banner>)}</div></Card>
    <Card title="Tabs"><Tabs value={tab} onChange={setTab} items={[{ value: 'first', label: 'First section' }, { value: 'second', label: 'Second section' }, { value: 'third', label: 'Third section' }]}><p>{tab} panel. Use arrow keys, Home, and End.</p></Tabs></Card>
    <Card title="Patient switcher"><div className={s.group}><PatientSwitcher patients={patients} activePatientId={patient} onChange={setPatient} />
      <PatientSwitcher patients={[]} loading /><PatientSwitcher patients={[]} /><PatientSwitcher patients={[]} error="Could not load linked patients." /></div></Card>
    <Card title="Day rail"><p>Five statuses, patient timezone, real dose spacing, and now marker. Vertical below 640px.</p>
      <DayRail doses={doses} timezone="Asia/Kolkata" now="2026-09-21T12:00:00Z" /><DayRail doses={[]} timezone="Asia/Kolkata" /></Card>
    <Card title="Midnight and late evening"><p>September 21 in Asia/Kolkata: 00:00 starts the day; 23:30 is near its end. Both doses belong to the same local date.</p>
      <DayRail doses={midnightDoses} timezone="Asia/Kolkata" now="2026-09-21T12:00:00Z" /></Card>
    <Card title="Browser timezone fallback"><p>This example omits the timezone to demonstrate the browser fallback.</p>
      <DayRail doses={midnightDoses} now="2026-09-21T12:00:00Z" /></Card>
  </main>;
}
export default function DevUI() {
  const query = new URLSearchParams(window.location.search); const theme = query.get('theme') === 'dark' ? 'dark' : 'light';
  if (query.has('frame')) return <Gallery theme={theme} />;
  return <main className={s.index}><PageHeader title="MediTrack UI foundations" description="Both themes use the exact token file in separate documents, including floating layers." />
    <p><a href="/dev/ui?frame=1&theme=light">Open light preview</a> · <a href="/dev/ui?frame=1&theme=dark">Open dark preview</a></p>
    <div className={s.previews}>{['light', 'dark'].map((mode) => <iframe key={mode} title={`${mode} component preview`} src={`/dev/ui?frame=1&theme=${mode}`} />)}</div></main>;
}
