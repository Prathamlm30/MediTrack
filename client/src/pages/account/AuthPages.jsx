import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import * as auth from '../../api/auth.js';
import { preview } from '../../api/invitations.js';
import { SESSION_ENDED } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import PasswordInput from '../../components/PasswordInput.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Banner from '../../components/Banner.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import { authPath, passwordError, passwordHelp, rememberRegistration, pendingRegistration, clearRegistration, verifyOnce } from './authFlow.js';
import s from './Account.module.css';

function InvitationNotice({ token }) {
  const [state, setState] = useState(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!token) return;
    let live = true; setState(null);
    preview(token).then((data) => { if (live) setState({ data }); }, (error) => { if (live) setState({ error }); });
    return () => { live = false; };
  }, [token, attempt]);
  if (!token) return null;
  if (!state) return <Skeleton label="Loading invitation" />;
  if (state.error) {
    const message = { 404: 'This invitation could not be found. Ask the sender for the original link.', 410: 'This invitation has expired. Ask the sender for a new invitation.', 409: 'This invitation has already been answered.' }[state.error.status];
    return message ? <Banner tone="warning">{message} You can still create an account or sign in. <Button variant="secondary" onClick={() => setAttempt(attempt + 1)}>Retry</Button></Banner> : <ErrorState onRetry={() => setAttempt(attempt + 1)}>{state.error.message}</ErrorState>;
  }
  return <Banner>{state.data.invitation.inviter.fullName} invited you to connect on MediTrack. Sign in with the email that received the invitation.</Banner>;
}

function GoogleSignIn({ onSuccess, onError, focusRef, busy }) {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return <div ref={focusRef} tabIndex={-1} role="group" className={s.google} aria-label="Google Sign-In" aria-busy={busy || undefined}>
    {clientId ? <GoogleOAuthProvider clientId={clientId}><GoogleLogin
      onSuccess={onSuccess} onError={() => onError('Google Sign-In did not complete. Try again.')}
      useOneTap={false} size="large" text="continue_with" /></GoogleOAuthProvider>
      : <Banner>Google Sign-In is unavailable in this environment. Email and password sign-in is available below.</Banner>}
  </div>;
}

export function Landing() {
  const { checking, session, error, retrySession } = useAuth(); const navigate = useNavigate();
  if (checking) return <div className={s.stack}><PageHeader title="MediTrack" /><Skeleton height="calc(var(--s10) * 4)" label="Checking your session" /></div>;
  if (error) return <ErrorState headingLevel={1} onRetry={retrySession}>{error}</ErrorState>;
  if (session) return <Navigate to="/dashboard" replace />;
  return <div className={s.stack}><h1 className={s.headline}>Keep track of your medicines and the people you care for.</h1>
    <p>See your day’s medication schedule and share it with the people you trust, all from one account.</p>
    <div className={s.actions}><Button onClick={() => navigate('/signup')}>Sign up</Button><Button variant="secondary" onClick={() => navigate('/login')}>Log in</Button></div>
    <p className={s.muted}>MediTrack is a student project, not a medical device.</p></div>;
}

export function SignInPage({ signup = false }) {
  const [query] = useSearchParams(); const inviteToken = query.get('inviteToken');
  const { setSession } = useAuth(); const navigate = useNavigate(); const location = useLocation(); const googleRef = useRef(null);
  const [values, setValues] = useState({ fullName: '', email: '', phoneNumber: '', password: '' });
  const [busy, setBusy] = useState(false); const inFlight = useRef(false);
  const [errors, setErrors] = useState({}); const [registered, setRegistered] = useState(false);
  const [passwordTouched, setPasswordTouched] = useState(false);
  const change = (key) => (event) => { setValues({ ...values, [key]: event.target.value }); setErrors({}); };
  function finish(data) {
    setSession(data); clearRegistration();
    const from = location.state?.from;
    navigate(inviteToken ? `/invitations/${encodeURIComponent(inviteToken)}` : typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') ? from : '/dashboard', { replace: true });
  }
  async function googleLogin(response) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setErrors({});
    try { finish(await auth.google(response.credential)); }
    catch (error) { setErrors({ google: error.message }); }
    finally { inFlight.current = false; setBusy(false); }
  }
  async function submit(event) {
    event.preventDefault();
    if (inFlight.current) return;
    const invalid = signup ? passwordError(values.password) : '';
    if (invalid) { setPasswordTouched(true); return; }
    if (signup && !values.fullName.trim()) { setErrors({ fullName: 'Enter your full name.' }); return; }
    inFlight.current = true; setBusy(true); setErrors({});
    try {
      if (signup) {
        await auth.register({ ...values, fullName: values.fullName.trim(), email: values.email.trim(), phoneNumber: values.phoneNumber.trim() || null });
        rememberRegistration(values.email.trim(), inviteToken); setRegistered(true);
      } else finish(await auth.login({ email: values.email.trim(), password: values.password }));
    } catch (error) {
      if (!signup && error.status === 400 && /Google/i.test(error.message)) {
        setErrors({ google: 'This email signs in with Google. Use the Google button above.' });
        googleRef.current?.querySelector('[role="button"], button, iframe')?.focus();
        if (!googleRef.current?.contains(document.activeElement)) googleRef.current?.focus();
      } else if (!signup && error.status === 401) setErrors({ credentials: 'Invalid email or password. Check both fields and try again.' });
      else if (!signup && error.status === 403 && /verify your email/i.test(error.message)) setErrors({ email: 'Verify your email before signing in.', unverified: true });
      else if (signup && error.status === 409) setErrors({ email: 'This email is already registered. Log in or reset your password.' });
      else setErrors({ form: error.message });
    } finally { inFlight.current = false; setBusy(false); }
  }
  if (registered) return <div className={s.stack}><PageHeader title="Check your email" />
    <p>Open the verification link sent to <strong>{values.email.trim()}</strong>, then return to sign in. The link is good for 24 hours.</p>
    {inviteToken && <Banner>Your invitation will be waiting after you verify your email and sign in.</Banner>}
    <Button onClick={() => navigate(authPath('/login', inviteToken))}>Continue to sign in</Button></div>;
  return <div className={s.stack}><PageHeader title={signup ? 'Create your account' : 'Log in'} />
    <InvitationNotice token={inviteToken} />
    {query.get('notice') === 'session-ended' && <Banner tone="warning">{SESSION_ENDED}</Banner>}
    {location.state?.passwordReset && <Banner>Your password was reset. Any existing session was signed out. Sign in with your new password.</Banner>}
    <GoogleSignIn focusRef={googleRef} busy={busy} onSuccess={googleLogin} onError={(google) => setErrors({ google })} />
    {errors.google && <p className={s.error} role="alert">{errors.google}</p>}
    <div className={s.divider}>or use your email</div>
    <form className={s.form} onSubmit={submit} aria-busy={busy}>
      {signup && <Field label="Full name" required error={errors.fullName}><TextInput autoComplete="name" maxLength={255} value={values.fullName} onChange={change('fullName')} disabled={busy} /></Field>}
      <Field label="Email" required error={errors.email}><TextInput type="email" autoComplete="username" maxLength={254} value={values.email} onChange={change('email')} disabled={busy} aria-describedby={errors.credentials ? 'credentials-error' : undefined} aria-invalid={errors.credentials ? true : undefined} /></Field>
      {errors.unverified && <Banner tone="warning">Open the verification email for {values.email}. Check your spam folder too. The link expires after 24 hours. If it has expired, contact the project administrator; a resend option is not available yet.</Banner>}
      {signup && <Field label="Phone number" help="Optional"><TextInput type="tel" autoComplete="tel" maxLength={40} value={values.phoneNumber} onChange={change('phoneNumber')} disabled={busy} /></Field>}
      <Field label="Password" required help={signup ? passwordHelp : undefined} error={signup && passwordTouched ? passwordError(values.password) : undefined}>
        <PasswordInput autoComplete={signup ? 'new-password' : 'current-password'} value={values.password} disabled={busy}
          onChange={(event) => { change('password')(event); setPasswordTouched(true); }} aria-describedby={errors.credentials ? 'credentials-error' : undefined} aria-invalid={errors.credentials ? true : undefined} /></Field>
      {errors.credentials && <p id="credentials-error" className={s.error} role="alert">{errors.credentials}</p>}
      {!signup && <Link to={authPath('/forgot-password', inviteToken)}>Forgot password?</Link>}
      {errors.form && <><Banner tone="danger">{errors.form}</Banner><Button type="submit" variant="secondary" disabled={busy}>Retry</Button></>}
      {(errors.credentials || errors.email) && <Button type="submit" variant="secondary" disabled={busy}>Retry</Button>}
      <Button type="submit" loading={busy}>{signup ? 'Create account' : 'Log in'}</Button>
    </form>
    <p>{signup ? 'Already have an account? ' : 'New to MediTrack? '}<Link to={authPath(signup ? '/login' : '/signup', inviteToken)}>{signup ? 'Log in' : 'Sign up'}</Link></p>
  </div>;
}

export function ForgotPassword() {
  const [query] = useSearchParams(); const inviteToken = query.get('inviteToken');
  const [email, setEmail] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [done, setDone] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError('');
    try { await auth.forgotPassword(email.trim()); setDone(true); }
    catch (err) { setError(err.message); } finally { setBusy(false); }
  }
  return <div className={s.stack}><PageHeader title={done ? 'Check for a reset link' : 'Forgot password'} />
    {done ? <><p>If that email has a MediTrack account with a password, a reset link is on its way.</p><p className={s.muted}>Reset links expire after 15 minutes. If you use Google, continue with Google on the login page.</p></>
      : <form className={s.form} onSubmit={submit}><Field label="Email" required><TextInput type="email" maxLength={254} autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} disabled={busy} /></Field>
        {error && <><Banner tone="danger">{error}</Banner><Button type="submit" variant="secondary" disabled={busy}>Retry</Button></>}<Button type="submit" loading={busy}>Send reset link</Button></form>}
    <Link to={authPath('/login', inviteToken)}>Back to log in</Link></div>;
}

export function ResetPassword() {
  const [query] = useSearchParams(); const token = query.get('token'); const inviteToken = query.get('inviteToken');
  const [password, setPassword] = useState(''); const [confirmation, setConfirmation] = useState(''); const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [invalid, setInvalid] = useState(!token || !/^[a-f0-9]{64}$/.test(token));
  const navigate = useNavigate(); const { setSession } = useAuth();
  async function submit(event) {
    event.preventDefault(); setTouched(true);
    if (passwordError(password) || password !== confirmation) return;
    setBusy(true); setError('');
    try { await auth.resetPassword(token, password); setSession(null); navigate(authPath('/login', inviteToken), { replace: true, state: { passwordReset: true } }); }
    catch (err) { if (err.status === 400 && /token/i.test(err.message)) setInvalid(true); else setError(err.message); }
    finally { setBusy(false); }
  }
  if (invalid) return <div className={s.stack}><PageHeader title="This reset link cannot be used" /><Banner tone="warning">The link is invalid, has already been used, or expired after 15 minutes.</Banner><Link to={authPath('/forgot-password', inviteToken)}>Request a new reset link</Link>{password && <Button variant="secondary" loading={busy} onClick={submit}>Retry</Button>}</div>;
  return <div className={s.stack}><PageHeader title="Reset password" /><form className={s.form} onSubmit={submit}>
    <Field label="New password" required help={passwordHelp} error={touched ? passwordError(password) : undefined}><PasswordInput autoComplete="new-password" value={password} onChange={(e) => { setPassword(e.target.value); setTouched(true); }} disabled={busy} /></Field>
    <Field label="Confirm new password" required error={(confirmation || touched) && confirmation !== password ? 'Passwords do not match.' : undefined}><PasswordInput autoComplete="new-password" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} disabled={busy} /></Field>
    {error && <><Banner tone="danger">{error}</Banner><Button type="submit" variant="secondary" disabled={busy}>Retry</Button></>}<Button type="submit" loading={busy}>Reset password</Button></form></div>;
}

export function VerifyEmail() {
  const { token } = useParams(); const [query] = useSearchParams(); const navigate = useNavigate();
  const [inviteToken] = useState(() => query.get('inviteToken') || pendingRegistration()?.inviteToken);
  const [state, setState] = useState(null); const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true; setState(null);
    verifyOnce(token).then(() => { if (live) setState({ verified: true }); }, (error) => { if (live) setState({ error }); });
    return () => { live = false; };
  }, [token, attempt]);
  if (!state) return <div className={s.stack}><PageHeader title="Verifying your email" /><Skeleton height="calc(var(--s10) * 2)" label="Verifying your email" /></div>;
  if (state.verified) return <div className={s.stack}><PageHeader title="Email verified" /><p>Your email is verified. You can now sign in{inviteToken ? ' to continue to your invitation' : ''}.</p><Button onClick={() => navigate(authPath('/login', inviteToken))}>Continue to sign in</Button></div>;
  if (!state.error.status || state.error.status >= 500) return <ErrorState headingLevel={1} title="Could not verify your email" onRetry={() => setAttempt(attempt + 1)}>{state.error.message}</ErrorState>;
  return <div className={s.stack}><PageHeader title="This verification link cannot be used" />
    <Banner tone="warning">{state.error.status === 400 ? 'The link is invalid, has already been used, or expired after 24 hours.' : state.error.message}</Banner>
    <Button variant="secondary" onClick={() => setAttempt(attempt + 1)}>Retry</Button>
    <p>If you already verified your email, continue to sign in. Otherwise, check the original email link. For an expired link, contact the project administrator; a resend option is not available yet.</p>
    <Button onClick={() => navigate(authPath('/login', inviteToken))}>Continue to sign in</Button></div>;
}
