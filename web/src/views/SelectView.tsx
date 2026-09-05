import { useMemo, useState } from 'react';
import type { Catalog } from '../api.js';

export function SelectView({
  catalog,
  onExport,
  onLogout,
  onRefresh,
}: {
  catalog: Catalog;
  onExport: (categoryIds: number[]) => void;
  onLogout: () => void;
  onRefresh: () => void;
}) {
  const { account, categories } = catalog;
  const [checked, setChecked] = useState<Set<number>>(() => new Set(categories.map((c) => c.id)));
  const [busy, setBusy] = useState(false);

  const selectedDocs = useMemo(
    () => categories.filter((c) => checked.has(c.id)).reduce((n, c) => n + c.count, 0),
    [categories, checked],
  );
  const totalDocs = useMemo(() => categories.reduce((n, c) => n + c.count, 0), [categories]);

  function toggle(id: number) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setAll(on: boolean) {
    setChecked(on ? new Set(categories.map((c) => c.id)) : new Set());
  }

  async function start() {
    if (busy || checked.size === 0) return;
    setBusy(true);
    try {
      await onExport([...checked]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card">
      <div className="account-row">
        <div>
          <div className="account-name">{account.fullName ?? 'Resident'}</div>
          <div className="muted small">
            {account.unitNo ? `Unit ${account.unitNo}` : ''}
            {account.condoName ? ` · ${account.condoName}` : ''}
          </div>
        </div>
        <div className="account-actions">
          <button className="link" onClick={onRefresh}>Refresh</button>
          <button className="link" onClick={onLogout}>Sign out</button>
        </div>
      </div>

      <h1>Your documents</h1>
      <p className="muted">
        {totalDocs} documents in {categories.length} categories. Everything is bundled into a single zip.
      </p>

      <div className="toolbar">
        <button className="link" onClick={() => setAll(true)}>Select all</button>
        <button className="link" onClick={() => setAll(false)}>Clear</button>
      </div>

      <ul className="categories">
        {categories.map((c) => (
          <li key={c.id} className={checked.has(c.id) ? 'checked' : ''}>
            <label className="category-row">
              <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
              <span className="category-name">{c.name}</span>
              <span className="category-count">{c.count}</span>
            </label>
            <details className="doc-list">
              <summary>list</summary>
              <ul>
                {c.docs.map((d) => (
                  <li key={d.id} className={d.kind === 'link' ? 'link-doc' : ''}>
                    {d.kind === 'link' ? '↗ ' : ''}
                    {d.caption || '(untitled)'}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>

      <div className="sticky-footer">
        <div className="muted small">
          {selectedDocs} of {totalDocs} documents selected
        </div>
        <button className="primary" onClick={start} disabled={busy || checked.size === 0}>
          {busy ? 'Starting…' : `Export ${selectedDocs} documents`}
        </button>
      </div>
    </div>
  );
}
