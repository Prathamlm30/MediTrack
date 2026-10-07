import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { sendSupport, supportOutcome, supportValidation } from '../../api/support.js';
import PageHeader from '../../components/PageHeader.jsx';
import Field from '../../components/Field.jsx';
import TextInput from '../../components/TextInput.jsx';
import Textarea from '../../components/Textarea.jsx';
import Button from '../../components/Button.jsx';
import Banner from '../../components/Banner.jsx';
import s from '../notifications/Records.module.css';

export default function Support() {
  const { session } = useAuth(); const email = session.user.email;
  const [subject, setSubject] = useState(''), [message, setMessage] = useState('');
  const [touched, setTouched] = useState({});
  const [busy, setBusy] = useState(false), [outcome, setOutcome] = useState(null);
  const confirmation = useRef(null), inFlight = useRef(false);
  const errors = supportValidation(subject, message);
  const invalid = Boolean(errors.subject || errors.message);
  useEffect(() => { if (outcome?.sent) confirmation.current?.focus(); }, [outcome]);
  async function submit(event) {
    event.preventDefault();
    if (invalid || inFlight.current) return;
    inFlight.current = true; setBusy(true); setOutcome(null);
    try { const response = await sendSupport({ subject: subject.trim(), message: message.trim() }); setOutcome(supportOutcome(response.status)); }
    catch (error) { setOutcome(supportOutcome(error.status, error.retryAfter)); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div className={s.page}><PageHeader title="Contact support" />
    {outcome?.sent ? <div role="status" tabIndex={-1} ref={confirmation}><p>Your message was sent to support. You'll get a reply at {email} if one is needed.</p></div> :
      <form onSubmit={submit} className={s.form} noValidate>
        <Field label="Reply email" help="Replies will go to your account email."><TextInput type="email" value={email} readOnly /></Field>
        <Field label="Subject" required error={touched.subject && (errors.subject || (outcome?.validation && 'Check your subject before sending again.'))} help={`${subject.trim().length} / 120 characters`}><TextInput value={subject} disabled={busy} onChange={(e) => { setSubject(e.target.value); setTouched((old) => ({ ...old, subject: true })); setOutcome(null); }} /></Field>
        <Field label="Message" required error={touched.message && (errors.message || (outcome?.validation && 'Check your message before sending again.'))} help={`${message.trim().length} / 2,000 characters`}><Textarea rows={7} value={message} disabled={busy} onChange={(e) => { setMessage(e.target.value); setTouched((old) => ({ ...old, message: true })); setOutcome(null); }} /></Field>
        {outcome && <Banner tone="danger">{outcome.message}</Banner>}
        <div><Button type="submit" disabled={invalid} loading={busy}>Send message</Button></div>
      </form>}
  </div>;
}
