import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import * as relationships from '../../api/relationships.js';
import * as invitations from '../../api/invitations.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useActivePatient } from '../../context/ActivePatientContext.jsx';
import { authPath } from '../account/authFlow.js';
import Avatar from '../../components/Avatar.jsx';
import Banner from '../../components/Banner.jsx';
import Button from '../../components/Button.jsx';
import Card from '../../components/Card.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import EmptyState from '../../components/EmptyState.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import Field from '../../components/Field.jsx';
import Modal from '../../components/Modal.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Radio from '../../components/Radio.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import StatusPill from '../../components/StatusPill.jsx';
import TextInput from '../../components/TextInput.jsx';
import { useToast } from '../../components/Toast.jsx';
import s from './RelationshipPages.module.css';

const levels = [
  ['full_access', 'Full access', 'Sees everything a view-only caregiver sees, and will receive alerts as those are added in later phases.'],
  ['view_only', 'View only', "Sees today's doses, adherence, and refill alerts."],
  ['alerts_only', 'Alerts only', 'Sees refill alerts. Does not see doses or adherence.'],
];
const terminalTitles = { 404: 'Invitation not found', 409: 'Invitation already answered', 410: 'Invitation expired' };
const terminalHelp = { 404: 'Check the original email link or ask the sender for a new invitation.', 409: 'This invitation can no longer be accepted or declined. You can review your relationships.', 410: 'Ask the sender to send a new invitation.' };

function ManagePermissions({ link, onClose, onSaved, initialRevoke = false }) {
  const [level, setLevel] = useState(link.permissionLevel);
  const [confirm, setConfirm] = useState(initialRevoke);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [error, setError] = useState(''); const notify = useToast();
  async function save(revoking = false) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError('');
    try {
      if (revoking) await relationships.revoke(link.id);
      else await relationships.setPermission(link.id, level);
      notify(revoking ? 'Access revoked.' : 'Permissions updated.', 'success');
      await onSaved();
      onClose();
    } catch (err) { setConfirm(false); setError(err.message); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <>
    <Modal open onClose={busy ? () => {} : onClose} title="Manage permissions" description={`Choose what ${link.caregiver.fullName} can see.`}>
      <form className={s.stack} onSubmit={(event) => { event.preventDefault(); void save(); }}>
        <fieldset className={s.choices} disabled={busy}><legend>Permission level</legend>
          {levels.map(([value, label, help]) => <label key={value} className={s.choice}>
            <Radio name="permissionLevel" value={value} checked={level === value} onChange={() => setLevel(value)} />
            <span><strong>{label}</strong><span>{help}</span></span>
          </label>)}
        </fieldset>
        {link.status !== 'active' && <Banner>This relationship is {link.status}. Changing its permissions does not restore access.</Banner>}
        {error && <Banner tone="danger">{error}</Banner>}
        <div className={s.actions}><Button type="submit" loading={busy} disabled={level === link.permissionLevel}>Save permissions</Button><Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button></div>
        {link.status !== 'revoked' && <div className={s.destructive}><Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>Revoke access</Button></div>}
      </form>
    </Modal>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => save(true)} loading={busy} destructive
      title={`Revoke ${link.caregiver.fullName}'s access?`} consequence="They will stop seeing your information immediately." confirmLabel="Revoke access" />
  </>;
}

export function RelationshipsPage() {
  const [rows, setRows] = useState(null); const [error, setError] = useState(''); const [editing, setEditing] = useState(null);
  const { session } = useAuth(); const { refreshPatients } = useActivePatient(); const navigate = useNavigate();
  const load = useCallback(async (signal) => {
    try { const data = await relationships.getRelationships({ signal }); setRows(data.relationships); setError(''); }
    catch (err) { if (err.name !== 'AbortError') { setRows(null); setError(err.message); } }
  }, []);
  useEffect(() => { const controller = new AbortController(); void load(controller.signal); return () => controller.abort(); }, [load]);
  const invite = <Button onClick={() => navigate('/relationships/invite')}>Invite someone</Button>;
  return <div className={s.stack}><PageHeader title="My relationships" description="The people you share care with, in both directions." action={rows?.length ? invite : undefined} />
    {error ? <ErrorState title="Could not load relationships" onRetry={() => load()}>{error}</ErrorState>
      : !rows ? <Skeleton height="calc(var(--s10) * 4)" label="Loading relationships" />
        : !rows.length ? <EmptyState title="No one is linked to your account yet." action={invite}>An invitation is how a link starts. Invite someone to care for you, or someone you care for.</EmptyState>
          : ['patient', 'caregiver'].map((perspective) => <Card key={perspective} title={perspective === 'patient' ? 'People who care for me' : 'People I care for'}>
            {rows.some((link) => link.perspective === perspective) ? <ul className={s.list}>
              {rows.filter((link) => link.perspective === perspective).map((link) => {
                const other = perspective === 'patient' ? link.caregiver : link.patient;
                return <li key={link.id} className={s.row}>
                  <div className={s.identity}><Avatar fullName={other.fullName} /><div><h3>{other.fullName}</h3><p className={s.email}>{other.email}</p></div></div>
                  <div className={s.pills}><StatusPill status={link.status} /><StatusPill status={link.permissionLevel} /></div>
                  <dl className={s.details}><div><dt>Relationship type</dt><dd>{link.relationshipType}</dd></div><div><dt>Linked</dt><dd>{link.linkedAt ? <time dateTime={link.linkedAt}>{new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: session?.user?.preferences?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone }).format(new Date(link.linkedAt))}</time> : 'Not linked yet'}</dd></div></dl>
                  {perspective === 'patient' && <div className={s.actions}><Button variant="secondary" size="sm" onClick={() => setEditing({ link })}>Manage permissions</Button>
                    {link.status !== 'revoked' && <Button variant="danger" size="sm" onClick={() => setEditing({ link, revoke: true })}>Revoke</Button>}</div>}
                </li>;
              })}
            </ul> : <p className={s.muted}>No relationships in this direction yet.</p>}
          </Card>)}
    {editing && <ManagePermissions key={editing.link.id} link={editing.link} initialRevoke={editing.revoke} onClose={() => setEditing(null)} onSaved={async () => { await load(); refreshPatients(); }} />}
  </div>;
}

// A committed mutation stays committed even when the subsequent list refresh fails.
function RefreshNotice({ error, onRetry }) {
  return error ? <ErrorState title="Your change was saved, but relationships could not be refreshed" onRetry={onRetry}>{error}</ErrorState> : null;
}

export function InvitePage() {
  const [values, setValues] = useState({ inviteeEmail: '', relationshipType: '', proposedRole: 'caregiver' });
  const [errors, setErrors] = useState({}); const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [sent, setSent] = useState(null); const [refreshError, setRefreshError] = useState('');
  async function refresh() { try { await relationships.getRelationships(); setRefreshError(''); } catch (err) { setRefreshError(err.message); } }
  const change = (key, value) => { setValues((previous) => ({ ...previous, [key]: value })); setErrors({}); };
  async function submit(event) {
    event.preventDefault(); if (inFlight.current) return;
    if (!values.relationshipType.trim()) { setErrors({ relationshipType: 'Invalid relationshipType.' }); return; }
    inFlight.current = true; setBusy(true); setErrors({});
    try {
      const data = await invitations.invite({ inviteeEmail: values.inviteeEmail.trim(), relationshipType: values.relationshipType.trim(), proposedRole: values.proposedRole });
      setSent(data.invitation); await refresh();
    } catch (err) { setErrors(err.status === 400 && ['You cannot invite yourself.', 'Invalid email.'].includes(err.message) ? { email: err.message } : { form: err.message }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (sent) return <div className={s.stack}><PageHeader title="Invitation sent" /><Banner>Invitation sent to {sent.inviteeEmail}. The link works for 7 days.</Banner><p>For security, the invitation link is only in the email.</p>
    <RefreshNotice error={refreshError} onRetry={refresh} /><Link to="/relationships">Back to relationships</Link></div>;
  return <div className={s.stack}><PageHeader title="Invite someone" description="Choose how you want to share care." />
    <form className={s.form} onSubmit={submit} aria-busy={busy}>
      <Field label="Invitee email" required error={errors.email}><TextInput type="email" maxLength={254} autoComplete="email" value={values.inviteeEmail} onChange={(e) => change('inviteeEmail', e.target.value)} disabled={busy} /></Field>
      <Field label="Relationship type" required error={errors.relationshipType} help="Describe your relationship in your own words."><TextInput maxLength={255} value={values.relationshipType} onChange={(e) => change('relationshipType', e.target.value)} disabled={busy} /></Field>
      <div className={s.suggestions} aria-label="Relationship suggestions"><span className={s.muted}>Suggestions:</span>{['Daughter', 'Son', 'Spouse', 'Nurse'].map((label) => <Button key={label} size="sm" variant="secondary" disabled={busy} onClick={() => change('relationshipType', label.toLowerCase())}>{label}</Button>)}</div>
      <fieldset className={s.choices} disabled={busy}><legend>Invite them as your</legend>
        {[['caregiver', 'Caregiver', 'They will look after you and see the information you share.'], ['patient', 'Patient', 'You will look after them and see the information they share.']].map(([value, label, help]) => <label key={value} className={s.choice}>
          <Radio name="proposedRole" value={value} checked={values.proposedRole === value} onChange={() => change('proposedRole', value)} /><span><strong>{label}</strong><span>{help}</span></span>
        </label>)}
      </fieldset>
      <Banner>New relationships start with view-only access. The patient can change permissions at any time.</Banner>
      {errors.form && <Banner tone="danger">{errors.form}</Banner>}
      <div className={s.actions}><Button type="submit" loading={busy}>Send invitation</Button><Link to="/relationships">Cancel</Link></div>
    </form></div>;
}

export function InvitationPage() {
  const { token } = useParams();
  // Reset all response state if client-side navigation opens a different invitation.
  return <Invitation key={token} token={token} />;
}
function Invitation({ token }) {
  const { session, checking, signOut, error: sessionError, retrySession } = useAuth();
  const { refreshPatients } = useActivePatient(); const navigate = useNavigate(); const notify = useToast();
  const [state, setState] = useState(null); const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false); const inFlight = useRef(false); const [error, setError] = useState(null);
  const [result, setResult] = useState(null); const [refreshError, setRefreshError] = useState('');
  useEffect(() => {
    const controller = new AbortController(); setState(null);
    invitations.preview(token, { signal: controller.signal }).then((data) => setState({ invitation: data.invitation }), (err) => { if (err.name !== 'AbortError') setState({ error: err }); });
    return () => controller.abort();
  }, [token, attempt]);
  async function refresh(accepted) {
    try { await relationships.getRelationships(); setRefreshError(''); refreshPatients(); if (accepted) navigate('/relationships', { replace: true }); }
    catch (err) { setRefreshError(err.message); }
  }
  async function answer(accepted) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null);
    try {
      const data = await (accepted ? invitations.accept(token) : invitations.decline(token));
      setResult({ accepted, data });
      if (accepted) { const link = data.relationship; const other = link.perspective === 'patient' ? link.caregiver : link.patient; notify(`You are now linked with ${other.fullName}. View-only access is active.`, 'success'); }
      await refresh(accepted);
    } catch (err) { setError(err); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function switchAccount() {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true);
    try { await signOut(); navigate(authPath('/login', token), { replace: true }); }
    catch (err) { setError(err); }
    finally { inFlight.current = false; setBusy(false); }
  }
  if (!state) return <Skeleton height="calc(var(--s10) * 4)" label="Loading invitation" />;
  const failure = state.error || error;
  if (terminalTitles[failure?.status]) return <div className={s.stack}><PageHeader title={terminalTitles[failure.status]} /><Banner tone="warning">{failure.message}</Banner><p>{terminalHelp[failure.status]}</p><Link to={session ? '/relationships' : '/login'}>{session ? 'View relationships' : 'Log in'}</Link></div>;
  if (state.error) return <ErrorState title="Could not load invitation" onRetry={() => setAttempt((n) => n + 1)}>{state.error.message}</ErrorState>;
  if (result) return <div className={s.stack}><PageHeader title={result.accepted ? 'Invitation accepted' : 'Invitation declined'} /><Banner>{result.accepted ? 'Your relationship is active with view-only access.' : result.data.message}</Banner><RefreshNotice error={refreshError} onRetry={() => refresh(result.accepted)} /><Link to="/relationships">View relationships</Link></div>;
  const invitation = state.invitation;
  // Public preview intentionally omits inviteeEmail. Only an authorized answer can
  // confirm identity; never infer the invitee from the inviter or proposedRole.
  const wrongAccount = error?.status === 403;
  return <div className={s.stack}><PageHeader title="Invitation" />
    <div><h2>{invitation.inviter.fullName} invited you</h2><p className={s.email}>{invitation.inviter.email}</p></div>
    <dl className={s.details}><div><dt>Relationship type</dt><dd>{invitation.relationshipType}</dd></div></dl>
    <p>{invitation.proposedRole === 'caregiver' ? `You are invited to care for ${invitation.inviter.fullName}. Accepting gives you view-only access to their doses for today, adherence, and refill alerts.` : `${invitation.inviter.fullName} is offering to care for you. Accepting lets them see your doses for today, adherence, and refill alerts. You can change their permissions from your relationships page.`}</p>
    {checking ? <Skeleton label="Checking your session" /> : sessionError ? <ErrorState title="Could not check your session" onRetry={retrySession}>{sessionError}</ErrorState> : !session ? <>
      <p>Use the email address that received this invitation.</p>
      <div className={s.actions}><form method="post" action={invitations.publicAcceptAction(token)}><Button type="submit">Sign in to accept</Button></form><Button variant="secondary" onClick={() => navigate(authPath('/signup', token))}>Create an account</Button></div>
    </> : <>
      <p className={s.email}>Signed in as {session.user.email}.</p>
      {wrongAccount ? <><Banner tone="warning">{error.message} This invitation requires the invited email address; this account could not answer it.</Banner><Button variant="secondary" loading={busy} onClick={switchAccount}>Sign out and switch account</Button></> : <>
        <p>Accept or decline only if this is the email that received the invitation.</p>
        {error && <Banner tone="danger">{error.message}</Banner>}
        <div className={s.actions}><Button loading={busy} onClick={() => answer(true)}>Accept invitation</Button><Button variant="secondary" disabled={busy} onClick={() => answer(false)}>Decline invitation</Button></div>
        <Button variant="ghost" disabled={busy} onClick={switchAccount}>Sign out and switch account</Button>
      </>}
    </>}
  </div>;
}
