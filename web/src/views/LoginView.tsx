import { useState } from 'react';
import { useT } from '../i18n.js';

export function LoginView({ onLogin, initialEmail }: { onLogin: (email: string, password: string) => void; initialEmail: string }) {
  const { t } = useT();
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
      <h1>{t('loginTitle')}</h1>
      <p className="muted">{t('loginHint')}</p>
      <label>
        {t('email')}
        <input type="email" inputMode="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
      </label>
      <label>
        {t('password')}
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button className="primary" type="submit" disabled={busy || !email.trim() || !password}>
        {busy ? t('signingIn') : t('signIn')}
      </button>
    </form>
  );
}
