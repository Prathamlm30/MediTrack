import { Link, Outlet } from 'react-router-dom';
import LegalLinks from '../../components/layout/LegalLinks.jsx';
import PageHeader from '../../components/PageHeader.jsx';
import s from './LegalPages.module.css';

export function PublicLayout() {
  return <div className={s.layout}><header><Link to="/">MediTrack</Link></header><main id="main-content"><Outlet /></main><footer><LegalLinks /></footer></div>;
}
function Document({ title, children }) {
  return <article className={s.document}><PageHeader title={title} /><p className={s.updated}>Last updated 6 October 2026</p>{children}</article>;
}
const support = <Link to="/support">Contact support</Link>;
export function Privacy() {
  return <Document title="Privacy">
    <p>MediTrack is a student project. This page describes how the application handles information.</p>
    <section><h2>What we store</h2><p>We store account and profile information, sign-in details, preferences, invitations, and patient–caregiver relationships. Optional profile information can include your phone number, address, date of birth, and gender. Passwords are stored as hashes.</p>
      <p>Health records can include doctors, medications, prescription readings, schedules, dose logs and notes, inventory, adherence statistics, alerts, notifications, weekly reports, AI conversations, insights, and interaction flags. We also store an activity record.</p></section>
    <section><h2>Where it is stored</h2><p>Account and health records are stored in a PostgreSQL database. Prescription images are stored on the server’s disk; the database holds the image path and the extracted information. The prescription-reading service downloads the image into a temporary folder for processing, then cleans up that folder.</p>
      <p>Redis stores digests for refresh sessions and verification and password-reset tokens. Support messages are sent to the receiving mail system; there is no support-ticket database table.</p></section>
    <section><h2>Who receives data</h2>
      <h3>Gemini</h3><p>For prescription reading, Gemini receives the OCR transcript, values found by the initial extraction, and instructions for organizing the result. The transcript may contain personal and health information. Raw image bytes are processed by the prescription-reading service and are not part of this Gemini request.</p>
      <p>For chat, Gemini receives up to the latest 20 messages, optional related medication names, and context containing up to 30 active medications with dose and form information and up to 20 unacknowledged interaction flags with their stored descriptions. Anything personal you type into chat may be included.</p>
      <p>For adherence insights, Gemini receives seven-day dose-status counts and local-hour counts. That request does not add your patient ID, medicine names, or notes. Weekly summaries send patient-linked health information: patient ID, timezone, report dates, dose times and statuses, medicine names, and adherence records.</p>
      <p>For schedule generation, Gemini receives the frequency text you enter and the physical dose quantity and unit derived from the medication’s tracking and dosage information.</p>
      <h3>Google Sign-In</h3><p>When you choose Google Sign-In, the app uses Google Identity and verifies the returned credential. It uses your Google identity, verified email, name, and picture to resolve your account. This flow does not include your app health records or local password.</p>
      <h3>The email provider</h3><p>The configured email provider receives recipient addresses and email contents. Verification and password-reset emails contain action links. Invitations contain the inviter’s name, relationship details, and an invitation link. Weekly caregiver reports contain health summary text. Support emails contain your subject and message and your account email as the reply address.</p>
      <p>This project does not establish the data-retention practices of Gemini, Google, or the email provider.</p></section>
    <section><h2>Who can see what</h2><p>You control which caregivers you link and their access level. Access requires an active link.</p>
      <ul><li><strong>View only:</strong> the caregiver can read shared medications, doctors, prescriptions and images, schedules, inventory, dose history, adherence, insights, and weekly reports addressed to them. This does not include escalation alerts.</li>
        <li><strong>Alerts only:</strong> the caregiver can see linked-patient identity, refill alerts on the dashboard, and escalation alerts addressed to them. They can resolve their escalation alert after the dose is taken. They cannot read the dose schedule, adherence history, prescriptions, or weekly reports.</li>
        <li><strong>Full access:</strong> the caregiver has both viewing and alert access. They can also manage medications, doctors, prescriptions, schedules and inventory, log doses, and dismiss insights or acknowledge interaction flags.</li></ul>
      <p>No caregiver level gives access to your private chat or your profile and preferences. Weekly report notifications require viewing access; dose-linked alerts require alert access. Revoking a link stops these API reads. Database operators can access stored records; this project does not establish an operator governance policy.</p>
      <p>Prescription image sharing links work for 10 minutes. Anyone holding a valid link can open the image until it expires, including after caregiver access is revoked. Opening the image itself is not added to the activity record.</p></section>
    <section><h2>The activity record</h2><p>Account activity shows recorded successful sign-ins, authorized caregiver views, and permission changes. You can see entries where you performed the action or where your patient information was the subject. Caregivers can still see their own recorded actions after their link is revoked, but cannot read your complete activity record.</p>
      <p>Caregiver views are recorded at most once every 10 minutes per person and area. The list is not a record of every request or disclosure, and a logging failure can leave a sign-in or view unrecorded. Names shown are current display names.</p></section>
    <section><h2>What is not available yet</h2><p>In-app account deletion, data export, and automatic retention limits are not implemented. {support} for requests about your information.</p></section>
  </Document>;
}
export function MedicalDisclaimer() {
  return <Document title="Medical disclaimer">
    <p>MediTrack is a student project, not a medical device and not a substitute for a doctor. It does not provide medical advice.</p>
    <section><h2>Review automated information</h2><p>AI chat and insights can be wrong. Prescription reading is automated. Check every extracted value against the physical prescription before saving it. Ask your doctor or pharmacist about anything unclear.</p></section>
    <section><h2>Interaction warnings have limits</h2><p>Interaction warnings come from a small, fixed dataset. A missing warning does not mean a combination is safe. Ask your doctor or pharmacist to check your medicines.</p></section>
    <section><h2>Do not rely on reminders alone</h2><p>Reminders and alerts can fail or be delayed, including during server downtime. Reminders and alerts appear in the app; email is used for weekly caregiver reports when selected. In-app and email delivery exist; push and SMS delivery do not.</p></section>
    <section><h2>In an emergency</h2><p>Contact local emergency services (112 in India), and your doctor or pharmacist. Do not wait for an app notification or a support reply.</p></section>
  </Document>;
}
export function Terms() {
  return <Document title="Terms">
    <p>This is project text and should be reviewed by a qualified person before any public launch.</p>
    <section><h2>Using MediTrack</h2><p>By using MediTrack, you accept these terms. MediTrack is a student project, not a medical device or a substitute for a doctor.</p></section>
    <section><h2>Your information and caregivers</h2><p>You are responsible for the information you enter and for who you link as a caregiver. Review prescription readings before saving. Caregivers act on information you choose to share through the access level you grant.</p></section>
    <section><h2>Availability and medical information</h2><p>The service is provided as is, with no guarantee of availability. We may change or end the service. It does not provide medical advice. Read the <Link to="/medical-disclaimer">medical disclaimer</Link> before relying on its information.</p></section>
    <section><h2>Contact</h2><p>{support} about the project or these terms.</p></section>
  </Document>;
}
const questions = [
  ['How do I link a caregiver?', <>Open Relationships and choose Invite someone. Enter their email, a relationship description, and choose caregiver to invite them to care for you. The invitation is emailed and works for seven days. The invited person signs in with that verified email to accept; a new account must first verify its email. Accepted links start with View only access.</>],
  ['What can each access level see?', <>View only can read shared health records, schedules, dose history, adherence, insights, and their weekly reports. Alerts only can see patient identity, dashboard refill alerts, and their escalation alerts, but not dose or adherence history. Full access includes both and permits managing shared health records and logging doses. Private chat and profile preferences remain owner-only. See <Link to="/privacy">Privacy</Link> for details.</>],
  ['Why might a caregiver not see something?', <>The patient’s link must be active and allow the relevant type of access. View only does not include escalation alerts; Alerts only does not include dose history or weekly reports. A patient can change or revoke access from Relationships. Some notifications disappear when access changes and return if the required access is restored.</>],
  ['How does prescription reading work?', <>The uploaded image is read automatically, then the extracted information is prepared for review. Check it against the physical prescription and correct mistakes before confirming and saving. Automated reading can be wrong.</>],
  ['Can interaction warnings tell me all my medicines are safe together?', <>No. Warnings come from a small fixed dataset. A missing warning is not evidence that a combination is safe. Check with a doctor or pharmacist.</>],
  ['Which channels deliver reminders and alerts?', <>Reminders and alerts appear in the app. Only in-app and email delivery are implemented; choosing Email applies to weekly caregiver reports, not dose reminders or alerts. Push and SMS delivery are unavailable. Reminders can fail or be delayed.</>],
  ['How are weekly caregiver reports delivered?', <>Caregivers with View only or Full access can open their reports from a patient’s dashboard. Depending on the notification preference, the report is sent by email or stored as an in-app notification. Email contains health summary text. Alerts only does not include weekly reports.</>],
  ['How do I reset my password?', <>Use <Link to="/forgot-password">Forgot password</Link> on the login page. For an eligible password account, an emailed reset link works for 15 minutes and can be used once. Resetting signs out the existing session. Google-only accounts continue with Google Sign-In.</>],
  ['Can I delete my account or export my data?', <>These actions are not available in the app yet. {support} with your request.</>],
  ['Who can see account activity?', <>Open Account settings, then Account activity. You see recorded actions you performed or where your patient information was accessed. Caregiver views are recorded at most once every ten minutes per person and area, not on every request. Caregivers see their own actions, including after revocation, not a patient’s entire audit trail.</>],
  ['Is MediTrack a medical device?', <>No. It is a student project and is not a substitute for a doctor. AI chat, insights, and prescription readings can be wrong. Read the <Link to="/medical-disclaimer">medical disclaimer</Link>.</>],
];
export function FAQ() {
  return <Document title="Frequently asked questions">{questions.map(([question, answer]) => <details className={s.question} key={question}><summary>{question}</summary><p>{answer}</p></details>)}</Document>;
}
