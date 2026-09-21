import { useState } from 'react';
import { GoogleLogin, GoogleOAuthProvider } from '@react-oauth/google';
import { Link, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/dashboard/Dashboard.jsx';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ActivePatientProvider } from './context/ActivePatientContext.jsx';

function GoogleTest({ title }) {
  const { setSession } = useAuth();
  const [result, setResult] = useState(null);
  async function signIn(response) {
    try {
      const res = await fetch('/api/auth/google', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: response.credential }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSession(data);
      const profile = await fetch('/api/users/me', { headers: { Authorization: `Bearer ${data.accessToken}` } });
      if (!profile.ok) throw new Error('App JWT profile check failed.');
      setResult({ message: 'Google Sign-In and authenticated profile request succeeded.', ...await profile.json(), tokenType: data.tokenType, expiresIn: data.expiresIn });
    } catch (error) { setResult({ error: error.message }); }
  }
  return <><h1>{title}</h1><GoogleLogin onSuccess={signIn} onError={() => setResult({ error: 'Google Sign-In failed.' })} />
    <p>Inspect the /api/auth/google response in browser Network tools for the app JWT pair.</p>
    {result && <pre style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(result, null, 2)}</pre>}</>;
}
export default function App() {
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  const googlePage = (title) => clientId ? <GoogleOAuthProvider clientId={clientId}><GoogleTest title={title} /></GoogleOAuthProvider>
    : <p>Set VITE_GOOGLE_CLIENT_ID in client/.env to test Google Sign-In, or use the dashboard email login.</p>;
  return <AuthProvider><ActivePatientProvider><main style={{ maxWidth: 760, margin: '3rem auto', padding: '0 1rem', fontFamily: 'sans-serif' }}>
    <nav><Link to="/login">Login</Link> | <Link to="/signup">Sign Up</Link> | <Link to="/dashboard">Dashboard</Link></nav>
    <Routes><Route path="/login" element={googlePage('Login')} /><Route path="/signup" element={googlePage('Sign Up')} />
      <Route path="/dashboard/*" element={<Dashboard />} />
      <Route path="*" element={<p>Choose Login or Sign Up to test Google authentication.</p>} /></Routes>
  </main></ActivePatientProvider></AuthProvider>;
}
