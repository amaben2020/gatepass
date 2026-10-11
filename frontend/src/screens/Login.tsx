import { useState, type FormEvent } from 'react';
import { api } from '../api';
import type { User } from '../types';

type Props = { onLoggedIn: (user: User) => void; onError: (err: unknown) => void };

export function Login({ onLoggedIn, onError }: Props) {
  const [email, setEmail] = useState('ada@gatepass.dev');
  const [password, setPassword] = useState('supersecret');
  const [busy, setBusy] = useState(false);

  // Both endpoints set the session cookie; every later request carries it automatically.
  const submit = async (path: '/auth/login' | '/auth/register', e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    try {
      const { user } = await api<{ user: User }>('POST', path, { email, password });
      onLoggedIn(user);
    } catch (err) {
      onError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="screen" onSubmit={(e) => submit('/auth/login', e)}>
      <h1 className="title">Sign in</h1>
      <p className="muted">Seeded user: ada@gatepass.dev / supersecret. Register a second user in a private window to compete for seats.</p>
      <label className="field">
        Email
        <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
      </label>
      <label className="field">
        Password
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" />
      </label>
      <div className="spacer" />
      <button className="btn primary" disabled={busy}>Sign in</button>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => submit('/auth/register')}>
        Create account instead
      </button>
    </form>
  );
}
