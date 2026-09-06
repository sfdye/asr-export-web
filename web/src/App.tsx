import { useEffect, useState } from 'react';
import { api, type Account, type Catalog } from './api.js';
import { useT, type Lang } from './i18n.js';
import { LoginView } from './views/LoginView.js';
import { OtpView } from './views/OtpView.js';
import { SelectView } from './views/SelectView.js';
import { ExportView } from './views/ExportView.js';

function LangSwitch() {
  const { lang, setLang } = useT();
  const target: Lang = lang === 'en' ? 'zh' : 'en';
  return (
    <button
      type="button"
      className="lang-toggle"
      onClick={() => setLang(target)}
      aria-label={lang === 'en' ? '切换到中文' : 'Switch to English'}
    >
      {target === 'zh' ? '中文' : 'EN'}
    </button>
  );
}

type Step = 'boot' | 'login' | 'otp' | 'select' | 'export';

export function App() {
  const { t } = useT();
  const [step, setStep] = useState<Step>('boot');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
    // resuming a bookmarked export? the job page needs no session
    const jobParam = new URLSearchParams(window.location.search).get('job');
    if (jobParam) {
      setJobId(jobParam);
      setStep('export');
      return;
    }
    // resume straight into the wizard if the cookie session is still valid
    api
      .me()
      .then(() => loadCatalog())
      .catch(() => setStep('login'));
  }, []);

  async function loadCatalog() {
    setError(null);
    try {
      const cat = await api.catalog();
      setCatalog(cat);
      setStep('select');
    } catch (e) {
      // catalog fetch failed (session may still be fine) → login screen with
      // the error; a still-valid session resumes on the next page load
      setStep('login');
      setError(e instanceof Error ? e.message : t('loadFailed'));
    }
  }

  async function handleLogin(e: string, pw: string, otp?: string) {
    setError(null);
    setEmail(e);
    setPassword(pw);
    try {
      const res = await api.login(e, pw, otp);
      if (res.status === 'otp_required') {
        setOtpMessage(res.message);
        setStep('otp');
        return;
      }
      setPassword(''); // never keep it longer than the login handshake
      await loadCatalog();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('loginFailed'));
    }
  }

  async function handleLogout() {
    await api.logout();
    setCatalog(null);
    setJobId(null);
    setPassword('');
    setStep('login');
  }

  async function handleExport(categoryIds: number[]) {
    setError(null);
    try {
      const id = await api.createExport(categoryIds);
      window.history.replaceState(null, '', `/?job=${id}`);
      setJobId(id);
      setStep('export');
    } catch (e) {
      setError(e instanceof Error ? e.message : t('exportStartFailed'));
    }
  }

  async function handleExportFinished() {
    window.history.replaceState(null, '', '/');
    setJobId(null);
    await loadCatalog();
  }

  if (step === 'boot') {
    return (
      <div className="container">
        <div className="card center muted">{t('boot')}</div>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="site-header">
        <div>
          <div className="brand">ASR Document Export</div>
          <div className="brand-sub">{t('brandSub')}</div>
        </div>
        <LangSwitch />
      </header>

      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}

      {step === 'login' && (
        <LoginView key="login" onLogin={handleLogin} initialEmail={email} />
      )}
      {step === 'otp' && (
        <OtpView key="otp" email={email} message={otpMessage} onSubmit={(otp) => handleLogin(email, password, otp)} onBack={() => setStep('login')} />
      )}
      {step === 'select' && catalog && (
        <SelectView catalog={catalog} onExport={handleExport} onLogout={handleLogout} onRefresh={loadCatalog} />
      )}
      {step === 'export' && jobId && (
        <ExportView jobId={jobId} onFinished={handleExportFinished} onFailed={handleExportFinished} />
      )}

      <footer className="site-footer">
        <p>{t('footer')}</p>
      </footer>
    </div>
  );
}
