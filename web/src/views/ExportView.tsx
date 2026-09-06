import { useEffect, useMemo, useState } from 'react';
import { api, downloadUrl, formatBytes, type JobView } from '../api.js';
import { useT } from '../i18n.js';

// one-shot celebratory confetti on the done screen; CSS-only, no deps
function Confetti() {
  const COLORS = ['#c9a227', '#17324e', '#1e7d43', '#e08b3e', '#8fb4d9'];
  const pieces = useMemo(
    () =>
      Array.from({ length: 80 }, (_, i) => ({
        left: Math.random() * 100,
        delay: Math.random() * 0.8,
        duration: 2.4 + Math.random() * 1.8,
        color: COLORS[i % COLORS.length],
        width: 6 + Math.random() * 5,
        height: 8 + Math.random() * 6,
        round: Math.random() < 0.25,
        dx: `${(Math.random() * 2 - 1) * 140}px`,
        rot: `${(Math.random() > 0.5 ? 1 : -1) * (360 + Math.random() * 540)}deg`,
      })),
    [],
  );
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            left: `${p.left}%`,
            width: p.width,
            height: p.round ? p.width : p.height,
            background: p.color,
            borderRadius: p.round ? '50%' : '1px',
            animation: `confetti-fall ${p.duration}s linear ${p.delay}s forwards`,
            ['--dx' as string]: p.dx,
            ['--rot' as string]: p.rot,
          }}
        />
      ))}
    </div>
  );
}

export function ExportView({ jobId, onFinished, onFailed }: { jobId: string; onFinished: () => void; onFailed: () => void }) {
  const { t } = useT();
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let misses = 0; // tolerate transient poll failures (network blips, restarts)

    async function poll() {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        misses = 0;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') return; // stop polling on terminal states
      } catch (e) {
        if (stop) return;
        if (++misses >= 8) {
          setError(e instanceof Error ? e.message : t('lostTrack'));
          return;
        }
      }
      timer = setTimeout(poll, 1000);
    }
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId, t]);

  if (error) {
    return (
      <div className="card center">
        <h1>{t('exportProblem')}</h1>
        <div className="alert error">{error}</div>
        <p className="muted small">{t('expiredHint')}</p>
        <button className="primary" onClick={onFailed}>{t('backToDocs')}</button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="card center">
        <div className="spinner" aria-label="loading" />
        <p className="muted">{t('startingExport')}</p>
      </div>
    );
  }

  if (job.status === 'queued' || job.status === 'running') {
    const { done, total, failed, currentFile } = job.progress;
    const pct = total > 0 ? Math.round((done / total) * 100) : null;
    return (
      <div className="card">
        <h1>{t('preparingZip')}</h1>
        <p className="muted">{t('keepOpen')}</p>
        <div className={`progress-track ${pct === null ? 'indeterminate' : ''}`}>
          {pct !== null && <div className="progress-fill" style={{ width: `${pct}%` }} />}
        </div>
        <p className="muted">
          {pct !== null ? t('progressDone', { done, total, pct }) : t('listing')}
          {failed > 0 && <span className="warn">{t('nFailed', { n: failed })}</span>}
        </p>
        {currentFile && <p className="muted small truncate">{t('fetching', { file: currentFile })}</p>}
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="card center">
        <h1>{t('exportFailed')}</h1>
        <div className="alert error">{job.error ?? t('somethingWrong')}</div>
        <button className="primary" onClick={onFailed}>{t('backToDocs')}</button>
      </div>
    );
  }

  // done
  const failedList = job.failedFiles ?? [];
  const okDocs = job.progress.total - job.progress.failed;
  return (
    <div className="card center">
      <Confetti />
      <h1>{t('zipReady')}</h1>
      <p className="muted">
        {t('doneDocs', { n: okDocs, total: job.progress.total })}{job.zipSize ? ` · ${formatBytes(job.zipSize)}` : ''}
      </p>
      <a className="primary download" href={downloadUrl(job.id)} download={job.zipName}>
        {t('downloadZip')}
      </a>
      <p className="muted small">{t('deletedAfter24h')}</p>
      {failedList.length > 0 && (
        <details className="failed-details">
          <summary className="warn">
            {t(failedList.length > 1 ? 'couldNotFetch' : 'couldNotFetchOne', { n: failedList.length })}
          </summary>
          <ul>
            {failedList.map((f) => (
              <li key={f.path}>
                {f.path} — {f.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
      <button className="link" onClick={onFinished}>{t('exportSomethingElse')}</button>
    </div>
  );
}
