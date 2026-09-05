import { useState } from 'react';

export function OtpView({
  email,
  message,
  onSubmit,
  onBack,
}: {
  email: string;
  message: string;
  onSubmit: (otp: string) => void;
  onBack: () => void;
}) {
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !/^\d{4,8}$/.test(otp)) return;
    setBusy(true);
    try {
      await onSubmit(otp);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h1>One-time code</h1>
      <p className="muted">{message}</p>
      <p className="muted small">Sent to {email} · valid for a few minutes</p>
      <label>
        Code
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="••••••"
          maxLength={8}
          value={otp}
          onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
          autoFocus
        />
      </label>
      <button className="primary" type="submit" disabled={busy || !/^\d{4,8}$/.test(otp)}>
        {busy ? 'Verifying…' : 'Verify'}
      </button>
      <button type="button" className="link" onClick={onBack}>
        ← back to sign in
      </button>
    </form>
  );
}
