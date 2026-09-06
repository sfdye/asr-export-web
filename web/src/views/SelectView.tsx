import { useEffect, useMemo, useRef, useState } from 'react';
import { api, formatBytes, type Catalog } from '../api.js';
import { useT } from '../i18n.js';

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
  const { t } = useT();
  const { account, categories } = catalog;
  const [checked, setChecked] = useState<Set<number>>(() => new Set(categories.map((c) => c.id)));
  const [openCats, setOpenCats] = useState<Set<number>>(new Set());
  const [sizes, setSizes] = useState<Record<number, Record<string, number>>>({});
  const [sizeState, setSizeState] = useState<Record<number, 'loading' | 'done' | 'error'>>({});
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

  function toggleOpen(id: number) {
    setOpenCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    void loadSizes(id);
  }

  const sizeJobs = useRef(new Set<number>());

  // fetch a category's doc sizes once; failures are retried on next expand
  async function loadSizes(catId: number) {
    if (sizeJobs.current.has(catId)) return;
    sizeJobs.current.add(catId);
    setSizeState((s) => ({ ...s, [catId]: 'loading' }));
    try {
      const sz = await api.sizes(catId);
      setSizes((s) => ({ ...s, [catId]: sz }));
      setSizeState((s) => ({ ...s, [catId]: 'done' }));
    } catch {
      sizeJobs.current.delete(catId);
      setSizeState((s) => ({ ...s, [catId]: 'error' }));
    }
  }

  // estimate the zip size on page load: walk all categories sequentially
  // (the server HEADs 4 docs at a time), totals fill in as they arrive
  useEffect(() => {
    let stop = false;
    void (async () => {
      for (const c of categories) {
        if (stop) return;
        await loadSizes(c.id);
      }
    })();
    return () => {
      stop = true;
    };
  }, [categories]);

  function docSize(catId: number, docId: number, kind: string): string {
    if (kind !== 'file') return '';
    if (sizeState[catId] !== 'done') return '…';
    const n = sizes[catId]?.[String(docId)];
    return n ? formatBytes(n) : '';
  }

  function catTotal(catId: number): number | null {
    if (sizeState[catId] !== 'done') return null;
    const sz = sizes[catId];
    if (!sz) return null;
    return Object.values(sz).reduce((n, v) => n + v, 0);
  }

  const selCats = useMemo(() => categories.filter((c) => checked.has(c.id)), [categories, checked]);
  const estimating = selCats.some((c) => sizeState[c.id] === 'loading');
  const selectedBytes = useMemo(() => {
    if (!selCats.length || !selCats.every((c) => sizeState[c.id] === 'done' || sizeState[c.id] === 'error')) return null;
    return selCats.reduce((n, c) => n + (catTotal(c.id) ?? 0), 0);
  }, [selCats, sizeState]);

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
          <div className="account-name">{account.fullName ?? t('resident')}</div>
          <div className="muted small">
            {account.unitNo ? t('unit', { no: account.unitNo }) : ''}
            {account.condoName ? ` · ${account.condoName}` : ''}
          </div>
        </div>
        <div className="account-actions">
          <button className="link" onClick={onRefresh}>{t('refresh')}</button>
          <button className="link" onClick={onLogout}>{t('signOut')}</button>
        </div>
      </div>

      <h1>{t('yourDocuments')}</h1>
      <p className="muted">{t('docsInCats', { total: totalDocs, count: categories.length })}</p>

      <div className="toolbar">
        <button className="link" onClick={() => setAll(true)}>{t('selectAll')}</button>
        <button className="link" onClick={() => setAll(false)}>{t('clear')}</button>
      </div>

      <ul className="categories">
        {categories.map((c) => {
          const open = openCats.has(c.id);
          const total = catTotal(c.id);
          return (
            <li key={c.id} className={checked.has(c.id) ? 'checked' : ''}>
              <div className="category-row">
                <label className="category-main">
                  <input type="checkbox" checked={checked.has(c.id)} onChange={() => toggle(c.id)} />
                  <span className="category-text">
                    <span className="category-name">{c.name}</span>
                    <span className="category-sub">
                      {t(c.count === 1 ? 'nDocumentsOne' : 'nDocuments', { n: c.count })}
                      {total != null ? ` · ${formatBytes(total)}` : ''}
                    </span>
                  </span>
                </label>
                <button
                  type="button"
                  className="expand"
                  aria-expanded={open}
                  aria-label={open ? t('hideDocsIn', { name: c.name }) : t('showDocsIn', { name: c.name })}
                  onClick={() => toggleOpen(c.id)}
                >
                  <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
                    <path d="M2.5 4.5L6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              </div>
              <div className={`docs${open ? ' open' : ''}`}>
                <div className="docs-inner">
                  <ul>
                    {c.docs.map((d) => (
                      <li key={d.id} className={d.kind === 'link' ? 'link-doc' : ''}>
                        <span className="doc-caption">
                          {d.kind === 'link' ? '↗ ' : ''}
                          {d.caption || t('untitled')}
                        </span>
                        <span className="doc-size">{docSize(c.id, d.id, d.kind)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="sticky-footer">
        <div className="muted small">
          {t('selectedOf', { n: selectedDocs, total: totalDocs })}
          {selectedBytes != null ? t('zipSize', { size: formatBytes(selectedBytes) }) : estimating ? t('estimating') : ''}
        </div>
        <button className="primary" onClick={start} disabled={busy || checked.size === 0}>
          {busy ? t('starting') : t('exportNDocs', { n: selectedDocs })}
        </button>
      </div>
    </div>
  );
}
