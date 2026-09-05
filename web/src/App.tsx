import { useEffect, useState } from 'react';
import { api, type Account, type Catalog } from './api.js';
import { LoginView } from './views/LoginView.js';
import { OtpView } from './views/OtpView.js';
import { SelectView } from './views/SelectView.js';
import { ExportView } from './views/ExportView.js';

type Step = 'boot' | 'login' | 'otp' | 'select' | 'export';

export function App() {
  const [step, setStep] = useState<Step>('boot');
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [otpMessage, setOtpMessage] = useState('');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);

  useEffect(() => {
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
      // session ok but catalog failed → still show select with retry
      setStep('login');
      setError(e instanceof Error ? e.message : 'failed to load documents');
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
      setError(err instanceof Error ? err.message : 'login failed');
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
      setJobId(id);
      setStep('export');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not start the export');
    }
  }

  async function handleExportFinished() {
    setJobId(null);
    await loadCatalog();
  }

  if (step === 'boot') {
    return (
      <div className="container">
        <div className="card center muted">Checking your session…</div>
      </div>
    );
  }

  return (
    <div className="container">
      <header className="site-header">
        <div className="brand">ASR Document Export</div>
        <div className="brand-sub">Avenue South Residence · Habitap backup</div>
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
        <p>Downloads are prepared on our server, deleted after 24 hours, and never shared. Your password is not stored.</p>
      </footer>
    </div>
  );
}
