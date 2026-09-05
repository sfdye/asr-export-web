import { useState } from 'react';

export function LoginView({ onLogin, initialEmail }: { onLogin: (email: string, password: string) => void; initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim() || !password) return;
    setBusy(true);
    try {
      await onLogin(email.trim(), password);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>Sign in to Habitap</h1>
      <p className="muted">Use your Habitap account (the app you use for ASR documents). New devices receive a one-time email code.</p>
      <label>
        Email
        <input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>
      <label>
        Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="primary" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  );
}
