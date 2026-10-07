import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getMe, updateMe, updatePreferences } from '../../api/users.js';
import { getSession } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import Textarea from '../../components/Textarea.jsx';
import Select from '../../components/Select.jsx';
import Card from '../../components/Card.jsx';
import Avatar from '../../components/Avatar.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Banner from '../../components/Banner.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import ConfirmDialog from '../../components/ConfirmDialog.jsx';
import { useToast } from '../../components/Toast.jsx';
import s from './Account.module.css';

export function signInMethod(user) {
  if (user.hasPassword && (user.googleId || user.authProvider === 'google')) return 'Both linked';
  return user.authProvider === 'google' || !user.hasPassword ? 'Google' : 'Email and password';
}

// A fresh profile read also supplies preferences and provider flags to the shell.
export function AccountPage({ page }) {
  const { session, setSession } = useAuth(); const [state, setState] = useState(null); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setState(null);
    getMe().then(({ user }) => {
      if (!live) return;
      const current = getSession();
      if (current) setSession({ ...current, user });
      setState({ loaded: true });
    }, (error) => { if (live) setState({ error }); });
    return () => { live = false; };
  }, [page, attempt, setSession]);
  const title = { profile: 'My profile', edit: 'Edit profile', settings: 'Account settings', preferences: 'Notification preferences' }[page];
  if (!state) return <div className={s.stack}><PageHeader title={title} /><AccountLoading page={page} /><Skeleton height="var(--s6)" label="Loading account navigation" /></div>;
  if (state.error) return <ErrorState headingLevel={1} title="Could not load your account" onRetry={() => setAttempt(attempt + 1)}>{state.error.message}</ErrorState>;
  const Page = { profile: Profile, edit: EditProfile, settings: Settings, preferences: Preferences }[page];
  return <Page key={page} user={session.user} />;
}

function AccountLoading({ page }) {
  if (page === 'profile') return <Card><div className={s.stack}><Skeleton height="var(--s8)" label="Loading your account" /><dl className={s.details}>{['Name', 'Email', 'Phone number', 'Date of birth', 'Gender', 'Address', 'Sign-in method'].map((label) => <Detail key={label} label={label} value={<Skeleton height="1.55em" label={`Loading ${label.toLowerCase()}`} />} />)}</dl></div></Card>;
  if (page === 'settings') return <><Card title="Sign-in details"><Skeleton height="calc(var(--s8) * 3)" label="Loading sign-in details" /></Card><Card title="Password reset"><Skeleton height="calc(var(--s8) * 3)" label="Loading password reset information" /></Card></>;
  const fields = page === 'edit' ? ['Full name', 'Phone number', 'Address', 'Profile picture URL'] : ['Preferred notification channel', 'Language', 'Theme', 'Timezone'];
  return <Card><div className={s.form}>{fields.map((label) => <div className={s.stack} key={label}><p>{label}</p><Skeleton height={label === 'Address' ? 'calc(var(--s7) * 3)' : 'var(--h-control)'} label={`Loading ${label.toLowerCase()}`} /></div>)}<Skeleton height="var(--h-control)" label="Loading save controls" /></div></Card>;
}

function AccountLinks() {
  return <nav aria-label="Account pages" className={s.actions}><Link to="/profile">My profile</Link><Link to="/settings">Account settings</Link><Link to="/settings/notifications">Notification preferences</Link></nav>;
}

function Profile({ user }) {
  const navigate = useNavigate();
  const birthday = user.dateOfBirth ? new Intl.DateTimeFormat(undefined, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(user.dateOfBirth)) : 'Not provided';
  const rows = [['Name', user.fullName], ['Email', user.email], ['Phone number', user.phoneNumber], ['Date of birth', birthday], ['Gender', user.gender], ['Address', user.address], ['Sign-in method', signInMethod(user)]];
  return <div className={s.stack}><PageHeader title="My profile" action={<Button onClick={() => navigate('/profile/edit')}>Edit profile</Button>} />
    <Card><div className={s.stack}><div className={s.identity}><Avatar {...user} /><span>{user.fullName}</span></div><dl className={s.details}>{rows.map(([label, value]) => <Detail key={label} label={label} value={value} />)}</dl></div></Card><AccountLinks /></div>;
}
function Detail({ label, value }) { return <><dt>{label}</dt><dd>{value || 'Not provided'}</dd></>; }

function EditProfile({ user }) {
  const initial = { fullName: user.fullName || '', phoneNumber: user.phoneNumber || '', address: user.address || '', profilePictureUrl: user.profilePictureUrl || '' };
  const [values, setValues] = useState(initial); const [saved, setSaved] = useState(initial); const [busy, setBusy] = useState(false);
  const [error, setError] = useState(''); const [fields, setFields] = useState({}); const [confirm, setConfirm] = useState(false);
  const navigate = useNavigate(); const notify = useToast(); const { setSession } = useAuth();
  const dirty = Object.keys(saved).some((key) => values[key] !== saved[key]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn); return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const change = (key) => (event) => { setValues({ ...values, [key]: event.target.value }); setFields({}); setError(''); };
  async function submit(event) {
    event.preventDefault(); if (!dirty || busy) return;
    const invalid = {};
    if (!values.fullName.trim()) invalid.fullName = 'Enter your full name.';
    if (values.profilePictureUrl.trim()) {
      try { if (!['http:', 'https:'].includes(new URL(values.profilePictureUrl.trim()).protocol)) throw new Error(); }
      catch { invalid.profilePictureUrl = 'Enter an http or https image URL.'; }
    }
    setFields(invalid); if (Object.keys(invalid).length) return;
    setBusy(true); setError('');
    try {
      const { user: updated } = await updateMe({ fullName: values.fullName.trim(), phoneNumber: values.phoneNumber.trim() || null, address: values.address.trim() || null, profilePictureUrl: values.profilePictureUrl.trim() || null });
      const current = getSession(); if (current) setSession({ ...current, user: updated });
      setSaved(values); notify('Profile updated.', 'success'); navigate('/profile');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={`${s.stack} ${s.editor}`}><PageHeader title="Edit profile" />
    <Card><form className={s.form} onSubmit={submit}>
      <Field label="Full name" required error={fields.fullName}><TextInput autoComplete="name" maxLength={255} value={values.fullName} onChange={change('fullName')} disabled={busy} /></Field>
      <Field label="Phone number"><TextInput type="tel" autoComplete="tel" maxLength={255} value={values.phoneNumber} onChange={change('phoneNumber')} disabled={busy} /></Field>
      <Field label="Address"><Textarea autoComplete="street-address" maxLength={255} rows={3} value={values.address} onChange={change('address')} disabled={busy} /></Field>
      <Field label="Profile picture URL" help="Use an http or https image link. Leave blank to use your initials." error={fields.profilePictureUrl}><TextInput type="url" maxLength={2048} value={values.profilePictureUrl} onChange={change('profilePictureUrl')} disabled={busy} /></Field>
      {error && <><Banner tone="danger">{error}</Banner><Button type="submit" variant="secondary" disabled={busy}>Retry</Button></>}
      <div className={s.actions}><Button type="submit" loading={busy} disabled={!dirty}>Save changes</Button><Button variant="secondary" disabled={busy} onClick={() => dirty ? setConfirm(true) : navigate('/profile')}>Cancel</Button></div>
    </form></Card>
    <ConfirmDialog open={confirm} onClose={() => setConfirm(false)} onConfirm={() => navigate('/profile')} title="Discard profile changes?" consequence="Your unsaved profile changes will be lost." confirmLabel="Discard changes" destructive />
  </div>;
}

function Settings({ user }) {
  return <div className={s.stack}><PageHeader title="Account settings" />
    <Card title="Sign-in details"><dl className={s.details}><Detail label="Email" value={user.email} /><Detail label="Sign-in method" value={signInMethod(user)} /><Detail label="Email verification" value={user.emailVerified ? 'Verified' : 'Not verified'} /></dl></Card>
    {user.hasPassword && <Card title="Password reset"><div className={s.stack}><Banner>Changing your password is done through an emailed reset link. Completing the reset signs out any existing session.</Banner><Link to="/forgot-password">Request a password reset</Link></div></Card>}
    <div className={s.actions}><Link to="/settings/activity">Account activity</Link><Link to="/support">Contact support</Link></div>
    <AccountLinks /></div>;
}

function Preferences({ user }) {
  const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const unavailableChannel = ['push', 'sms'].includes(user.preferences?.preferredNotificationChannel);
  const initial = { preferredNotificationChannel: unavailableChannel ? '' : user.preferences?.preferredNotificationChannel || 'email', language: user.preferences?.language || 'en', timezone: user.preferences?.timezone || browserZone };
  const [values, setValues] = useState(initial); const [saved, setSaved] = useState(initial);
  const [themeAttempt, setThemeAttempt] = useState(null);
  const [busy, setBusy] = useState(false); const [themeBusy, setThemeBusy] = useState(false); const [error, setError] = useState(''); const [themeError, setThemeError] = useState('');
  const { setSession, setTheme } = useAuth(); const notify = useToast();
  const zones = [...new Set([browserZone, values.timezone, 'UTC', ...(Intl.supportedValuesOf?.('timeZone') || [])])].sort();
  const dirty = Object.keys(saved).some((key) => saved[key] !== values[key]) || !user.preferences?.timezone;
  const change = (key) => (event) => { setValues({ ...values, [key]: event.target.value }); setError(''); };
  async function changeTheme(event) {
    const theme = event.target.value; setThemeAttempt(theme);
    setThemeBusy(true); setThemeError('');
    try { await setTheme(theme); notify('Preferences saved.', 'success'); }
    catch (err) { setThemeError(err.message); } finally { setThemeBusy(false); }
  }
  async function submit(event) {
    event.preventDefault(); if (busy || themeBusy || !dirty || !values.preferredNotificationChannel) return;
    setBusy(true); setError('');
    try {
      const { preferences } = await updatePreferences({ preferredNotificationChannel: values.preferredNotificationChannel, language: values.language.trim(), timezone: values.timezone });
      const current = getSession(); if (current) setSession({ ...current, user: { ...current.user, preferences } });
      setSaved(values); notify('Preferences saved.', 'success');
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={`${s.stack} ${s.editor}`}><PageHeader title="Notification preferences" />
    {unavailableChannel && <Banner>Your saved channel is not available yet. Choose In the app or Email before saving.</Banner>}
    <Card><form className={s.form} onSubmit={submit}>
      <Field label="Preferred notification channel" help="Email sends weekly caregiver reports. Reminders and alerts appear in the app."><Select value={values.preferredNotificationChannel} onChange={change('preferredNotificationChannel')} disabled={busy || themeBusy}><option value="" disabled>Choose a channel</option><option value="in_app">In the app</option><option value="email">Email</option></Select></Field>
      <Field label="Language" required help="Save your preferred language code, such as en or hi. The interface is currently in English."><TextInput maxLength={100} value={values.language} onChange={change('language')} disabled={busy || themeBusy} pattern=".*\S.*" /></Field>
      <Field label="Theme" help={themeBusy ? 'Saving theme…' : 'Theme changes are saved immediately.'} error={themeError}><Select value={user.preferences?.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')} onChange={changeTheme} disabled={busy || themeBusy}><option value="light">Light</option><option value="dark">Dark</option></Select></Field>
      {themeError && <Button variant="secondary" disabled={busy || themeBusy} onClick={() => changeTheme({ target: { value: themeAttempt } })}>Retry</Button>}
      <Field label="Timezone" help="This decides which doses count as today on your dashboard."><Select value={values.timezone} onChange={change('timezone')} disabled={busy || themeBusy}>{zones.map((zone) => <option key={zone} value={zone}>{zone.replaceAll('_', ' ')}</option>)}</Select></Field>
      {error && <><Banner tone="danger">{error}</Banner><Button type="submit" variant="secondary" disabled={busy}>Retry</Button></>}<Button type="submit" loading={busy} disabled={!dirty || themeBusy || !values.preferredNotificationChannel}>Save preferences</Button>
    </form></Card><AccountLinks /></div>;
}
