import { useState } from 'react';
import { useT } from '../i18n.js';

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
  const { t } = useT();
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
      <h1>{t('otpTitle')}</h1>
      <p className="muted">{message}</p>
      <p className="muted small">{t('otpSentTo', { email })}</p>
      <label>
        {t('code')}
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
        {busy ? t('verifying') : t('verify')}
      </button>
      <button type="button" className="link" onClick={onBack}>
        {t('backToSignIn')}
      </button>
    </form>
  );
}
