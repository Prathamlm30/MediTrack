import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { createConversation, getConversations, getMessages, sendMessage } from '../../api/chat.js';
import { request } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import Card from '../../components/Card.jsx';
import Banner from '../../components/Banner.jsx';
import Button from '../../components/Button.jsx';
import Field from '../../components/Field.jsx';
import Textarea from '../../components/Textarea.jsx';
import Skeleton from '../../components/Skeleton.jsx';
import ErrorState from '../../components/ErrorState.jsx';
import textStyles from '../caregiver/Caregiver.module.css';
import s from './Chat.module.css';

const validId = (value) => /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

export default function Chat() {
  const { session } = useAuth();
  const [query] = useSearchParams();
  // A hand-written patient selector must never turn this into a caregiver view.
  if (query.has('patientId') && query.get('patientId') !== String(session.user.id)) return <>
    <PageHeader title="Private chat" /><Banner>Chat is private to its owner. Caregivers cannot view a patient’s conversations.</Banner><Link to="/chat">Open your own chat</Link>
  </>;
  return <OwnChat key={`${session.user.id}:${query.get('relatedMedicationId')}`} ownerId={session.user.id} relatedMedicationId={query.get('relatedMedicationId')} />;
}

function OwnChat({ ownerId, relatedMedicationId }) {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const [state, setState] = useState(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const creating = useRef(false);
  const alive = useRef(false);
  const refresh = () => setRevision((value) => value + 1);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      const data = await getConversations({ signal: controller.signal });
      let medication;
      if (relatedMedicationId) {
        if (!validId(relatedMedicationId)) throw new Error('Invalid medication. Open chat from your medication detail page.');
        medication = await request(`/api/medications/${relatedMedicationId}`, { signal: controller.signal });
        if (medication.patientId !== ownerId) throw new Error('You can only start chats about your own medications.');
      }
      if (!controller.signal.aborted) setState({ data, medication, scope: relatedMedicationId });
    })().catch((error) => { if (!controller.signal.aborted) setState({ error: error.message, scope: relatedMedicationId }); });
    return () => controller.abort();
  }, [ownerId, relatedMedicationId, revision]);
  const current = state?.scope === relatedMedicationId ? state : null;
  async function start() {
    if (creating.current || !current?.data) return;
    creating.current = true; setBusy(true); setFailure('');
    try {
      const conversation = await createConversation(relatedMedicationId ? Number(relatedMedicationId) : undefined);
      if (!alive.current) return;
      refresh(); navigate(`/chat/${conversation.id}`);
    } catch (error) { if (alive.current) setFailure(error.message); }
    finally { creating.current = false; if (alive.current) setBusy(false); }
  }
  return <div className={s.page}>
    <PageHeader title="Your private chat" description="Ask about your medications and your week. Only you can access these conversations." />
    {failure && <Banner tone="danger">{failure}</Banner>}
    <Card title="Conversations" action={<Button variant="secondary" onClick={refresh} disabled={busy}>Refresh conversations</Button>}>
      {current?.error ? <ErrorState onRetry={refresh}>{current.error}</ErrorState> : !current ? <Skeleton label="Loading conversations" /> : <>
        {current.medication && <p>New conversation about <strong>{current.medication.medicineName}</strong>.</p>}
        <Button onClick={start} loading={busy}>{current.medication ? 'Start medication conversation' : 'Start new conversation'}</Button>
        {current.data.conversations.length ? <ul className={s.conversations}>{current.data.conversations.map((row) => <li key={row.id}>
          <Link to={`/chat/${row.id}`} aria-current={String(row.id) === conversationId ? 'page' : undefined}>Conversation {row.id}{row.relatedMedicationId ? ` · Medication ${row.relatedMedicationId}` : ''}</Link>
        </li>)}</ul> : <p>No conversations yet.</p>}
      </>}
    </Card>
    {conversationId ? validId(conversationId) ? <Conversation key={conversationId} id={conversationId} /> : <Banner tone="danger">Invalid conversation.</Banner>
      : <p>Start a conversation or choose one above.</p>}
  </div>;
}

function Conversation({ id }) {
  const [history, setHistory] = useState(null);
  const [draft, setDraft] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [failure, setFailure] = useState('');
  const [revision, setRevision] = useState(0);
  const sending = useRef(false);
  const pending = useRef(null);
  const alive = useRef(false);
  const end = useRef(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; pending.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController(); pending.current = controller;
    getMessages(id, { signal: controller.signal }).then((data) => {
      if (!controller.signal.aborted) { setHistory({ data }); setConflict(false); }
    }).catch((error) => { if (!controller.signal.aborted) setHistory({ error: error.message }); });
    return () => controller.abort();
  }, [id, revision]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [history?.data?.messages.length, busy]);
  const validation = draft.length > 4000 ? 'Use 4,000 characters or fewer.' : !draft.trim() ? 'Enter a message with at least one non-space character.' : '';
  async function send(event) {
    event.preventDefault(); setTouched(true);
    if (validation || sending.current || conflict || !history?.data) return;
    sending.current = true; pending.current?.abort(); setBusy(true); setFailure('');
    try {
      const result = await sendMessage(id, draft);
      if (!alive.current) return;
      setHistory((previous) => ({ data: { disclaimer: result.disclaimer,
        messages: [...previous.data.messages, result.userMessage, result.aiMessage] } }));
      setDraft(''); setTouched(false);
    } catch (error) {
      if (!alive.current) return;
      setFailure(error.message);
      if (error.status === 409) setConflict(true);
      else {
        // Gemini can fail after the user message was stored. Reload without
        // automatically resending, which would duplicate that stored message.
        setRevision((value) => value + 1);
      }
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  }
  const refresh = () => { setHistory(null); setFailure(''); setRevision((value) => value + 1); };
  return <Card title={`Conversation ${id}`} action={<Button variant="secondary" onClick={refresh} disabled={busy}>Refresh messages</Button>}>
    {history?.error ? <ErrorState title="Could not open conversation" onRetry={refresh}>{history.error}</ErrorState>
      : !history ? <Skeleton label="Loading messages" /> : !history.data.disclaimer ? <ErrorState title="Could not load the required disclaimer" onRetry={refresh}>Refresh messages before continuing.</ErrorState> : <>
        <ol className={s.messages} aria-label="Conversation messages">{history.data.messages.map((message) => {
          const body = message.senderType === 'ai' && message.messageText.startsWith(history.data.disclaimer)
            ? message.messageText.slice(history.data.disclaimer.length).replace(/^\n+/, '')
            : message.messageText;
          return <li key={message.id} className={message.senderType === 'ai' ? s.ai : s.user} data-message-id={message.id}>
          <strong>{message.senderType === 'ai' ? 'MediTrack assistant' : 'You'}</strong>
          <div className={textStyles.summary}>{body}</div>
          {message.senderType === 'ai' && <p className={s.disclaimer} data-disclaimer-shown={String(message.disclaimerShown)}>
            {/* Every AI reply carries its stored flag and the returned disclaimer.
                Never decide whether to show it from the message's topic. */}
            {history.data.disclaimer}
          </p>}
        </li>;
        })}</ol>
        {!history.data.messages.length && <p>No messages yet. Write your first message below.</p>}
        <div ref={end} />
      </>}
    {failure && <Banner tone="warning">{failure}{conflict ? <p>A reply is already in progress. Wait, then refresh messages to check for it before sending again.</p>
      : <p>Your message may already be saved. Check the history before sending it again.</p>}</Banner>}
    <p role="status">{busy ? 'Generating a reply… You can send another message when it finishes.' : conflict ? 'Composer paused while a reply is being generated.' : ''}</p>
    <form onSubmit={send} className={s.composer}>
      <Field label="Message" required help={`${draft.length.toLocaleString()} / 4,000 characters. Line breaks are preserved.`} error={touched && validation}>
        <Textarea rows={4} value={draft} disabled={busy || conflict || !history?.data?.disclaimer} onChange={(event) => { setDraft(event.target.value); setTouched(true); }} />
      </Field>
      <Button type="submit" loading={busy} disabled={Boolean(validation) || conflict || !history?.data?.disclaimer}>Send message</Button>
    </form>
  </Card>;
}
