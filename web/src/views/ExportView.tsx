import { useEffect, useState } from 'react';
import { api, downloadUrl, formatBytes, type JobView } from '../api.js';

export function ExportView({ jobId, onFinished, onFailed }: { jobId: string; onFinished: () => void; onFailed: () => void }) {
  const [job, setJob] = useState<JobView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const j = await api.job(jobId);
        if (stop) return;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') return; // stop polling on terminal states
      } catch (e) {
        if (!stop) setError(e instanceof Error ? e.message : 'lost track of the export');
        return;
      }
      timer = setTimeout(poll, 1000);
    }
    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [jobId]);

  if (error) {
    return (
      <div className="card center">
        <h1>Export problem</h1>
        <div className="alert error">{error}</div>
        <p className="muted small">If it says “not found or expired”, the export or its zip passed the 24-hour mark.</p>
        <button className="primary" onClick={onFailed}>Back to my documents</button>
      </div>
    );
  }

  if (!job) {
    return (
      <div className="card center">
        <div className="spinner" aria-label="loading" />
        <p className="muted">Starting your export…</p>
      </div>
    );
  }

  if (job.status === 'queued' || job.status === 'running') {
    const { done, total, failed, currentFile } = job.progress;
    const pct = total > 0 ? Math.round((done / total) * 100) : null;
    return (
      <div className="card">
        <h1>Preparing your zip…</h1>
        <p className="muted">Keep this page open — or bookmark it and come back later (it works for 24 hours).</p>
        <div className={`progress-track ${pct === null ? 'indeterminate' : ''}`}>
          {pct !== null && <div className="progress-fill" style={{ width: `${pct}%` }} />}
        </div>
        <p className="muted">
          {pct !== null ? `${done} of ${total} documents (${pct}%)` : 'listing documents…'}
          {failed > 0 && <span className="warn"> · {failed} failed</span>}
        </p>
        {currentFile && <p className="muted small truncate">fetching: {currentFile}</p>}
      </div>
    );
  }

  if (job.status === 'failed') {
    return (
      <div className="card center">
        <h1>Export failed</h1>
        <div className="alert error">{job.error ?? 'something went wrong'}</div>
        <button className="primary" onClick={onFailed}>Back to my documents</button>
      </div>
    );
  }

  // done
  const failedList = job.failedFiles ?? [];
  return (
    <div className="card center">
      <h1>Your zip is ready</h1>
      <p className="muted">
        {job.progress.total - job.progress.failed} of {job.progress.total} documents{job.zipSize ? ` · ${formatBytes(job.zipSize)}` : ''}
      </p>
      <a className="primary download" href={downloadUrl(job.id)} download={job.zipName}>
        Download zip
      </a>
      <p className="muted small">The download link works for 24 hours and supports pause/resume.</p>
      {failedList.length > 0 && (
        <details className="failed-details">
          <summary className="warn">
            {failedList.length} document{failedList.length > 1 ? 's' : ''} could not be fetched
          </summary>
          <ul>
            {failedList.map((f) => (
              <li key={f.path}>
                {f.path} — {f.reason}
              </li>
            ))}
          </ul>
          <p className="muted small">These are also listed inside the zip in FAILED.txt.</p>
        </details>
      )}
      <button className="link" onClick={onFinished}>Export something else</button>
    </div>
  );
}
