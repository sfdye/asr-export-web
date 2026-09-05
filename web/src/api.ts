export interface Account {
  username?: string;
  fullName?: string;
  unitNo?: string;
  blockCode?: string;
  condoName?: string;
}

export interface DocInfo {
  id: number;
  caption: string;
  kind: 'file' | 'link' | 'none';
}

export interface CategoryInfo {
  id: number;
  name: string;
  count: number;
  docs: DocInfo[];
}

export interface Catalog {
  account: Account;
  categories: CategoryInfo[];
}

export interface JobView {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  progress: { done: number; total: number; failed: number; currentFile?: string };
  failedCount: number;
  failedFiles?: { path: string; reason: string }[];
  zipName?: string;
  zipSize?: number;
  error?: string;
  expiresAt: number;
}

async function json<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `request failed (${res.status})`);
  return body as T;
}

export const api = {
  async me(): Promise<Account> {
    return json<Account>(await fetch('/api/auth/me'));
  },

  async login(email: string, password: string, otp?: string): Promise<{ status: 'ok'; account: Account } | { status: 'otp_required'; message: string }> {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password, otp }),
    });
    if (res.status === 401 || res.status === 429 || res.status === 502) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? 'login failed');
    }
    return json(res);
  },

  async logout(): Promise<void> {
    await fetch('/api/auth/logout', { method: 'POST' });
  },

  async catalog(): Promise<Catalog> {
    return json<Catalog>(await fetch('/api/catalog'));
  },

  async createExport(categoryIds: number[]): Promise<string> {
    const { id } = await json<{ id: string }>(
      await fetch('/api/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ categoryIds }),
      }),
    );
    return id;
  },

  async job(id: string): Promise<JobView> {
    return json<JobView>(await fetch(`/api/export/jobs/${id}`));
  },
};

export const downloadUrl = (id: string) => `/api/export/jobs/${id}/download`;

export function formatBytes(n?: number): string {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
