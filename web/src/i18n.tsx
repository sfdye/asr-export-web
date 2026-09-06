import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export type Lang = 'en' | 'zh';

const STORAGE_KEY = 'asr-lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* private mode etc. — fall through to device locale */
  }
  const langs = navigator.languages?.length ? navigator.languages : [navigator.language];
  return langs.some((l) => l.toLowerCase().startsWith('zh')) ? 'zh' : 'en';
}

const en = {
  boot: 'Checking your session…',
  brandSub: 'Avenue South Residence · Habitap backup',
  footer:
    'Downloads are prepared on the server, deleted after 24 hours, and never shared. Your password is not stored.',

  loginTitle: 'Sign in to Habitap',
  loginHint: 'Use your Habitap account (the app you use for ASR documents). New devices receive a one-time email code.',
  email: 'Email',
  password: 'Password',
  signingIn: 'Signing in…',
  signIn: 'Sign in',

  otpTitle: 'One-time code',
  otpSentTo: 'Sent to {email} · valid for a few minutes',
  code: 'Code',
  verifying: 'Verifying…',
  verify: 'Verify',
  backToSignIn: '← back to sign in',

  resident: 'Resident',
  unit: 'Unit {no}',
  refresh: 'Refresh',
  signOut: 'Sign out',
  yourDocuments: 'Your documents',
  docsInCats: '{total} documents in {count} categories, bundled into a single download.',
  selectAll: 'Select all',
  clear: 'Clear',
  nDocuments: '{n} documents',
  nDocumentsOne: '{n} document',
  showDocsIn: 'Show documents in {name}',
  hideDocsIn: 'Hide documents in {name}',
  untitled: '(untitled)',
  selectedOf: '{n} of {total} documents selected',
  zipSize: ' · ≈ {size} total',
  estimating: ' · estimating size…',
  starting: 'Starting…',
  exportNDocs: 'Export {n} documents',

  exportProblem: 'Export problem',
  lostTrack: 'lost track of the export',
  expiredHint: 'If it says “not found or expired”, the export or its download passed the 24-hour mark.',
  backToDocs: 'Back to my documents',
  startingExport: 'Starting your export…',
  preparingZip: 'Preparing your file…',
  keepOpen: 'Keep this page open — or bookmark it and come back later (it works for 24 hours).',
  progressDone: '{done} of {total} documents ({pct}%)',
  listing: 'listing documents…',
  nFailed: ' · {n} failed',
  fetching: 'fetching: {file}',
  exportFailed: 'Export failed',
  somethingWrong: 'something went wrong',
  zipReady: 'Your file is ready',
  doneDocs: '{n} of {total} documents',
  downloadZip: 'Download now',
  deletedAfter24h: 'The download link works for 24 hours — after that your file is deleted from the server.',
  couldNotFetch: '{n} documents could not be fetched',
  couldNotFetchOne: '{n} document could not be fetched',
  exportSomethingElse: 'Export something else',

  loadFailed: 'failed to load documents',
  loginFailed: 'login failed',
  exportStartFailed: 'could not start the export',
} as const;

export type TKey = keyof typeof en;

const zh: Record<TKey, string> = {
  boot: '正在检查登录状态…',
  brandSub: 'Avenue South Residence · Habitap 备份',
  footer: '文件在服务器上打包，24 小时后自动删除，绝不对外共享。您的密码不会被存储。',

  loginTitle: '登录 Habitap',
  loginHint: '使用您的 Habitap 账号（您平时用来查看 ASR 文件的应用）。首次在新设备登录时，系统会向您的邮箱发送一次性验证码。',
  email: '邮箱',
  password: '密码',
  signingIn: '登录中…',
  signIn: '登录',

  otpTitle: '一次性验证码',
  otpSentTo: '已发送至 {email} · 几分钟内有效',
  code: '验证码',
  verifying: '验证中…',
  verify: '验证',
  backToSignIn: '← 返回登录',

  resident: '住户',
  unit: '门牌号 {no}',
  refresh: '刷新',
  signOut: '退出登录',
  yourDocuments: '您的文件',
  docsInCats: '共 {total} 份文件，分为 {count} 个类别，全部打包成一个压缩包供您下载。',
  selectAll: '全选',
  clear: '清空',
  nDocuments: '{n} 份文件',
  nDocumentsOne: '{n} 份文件',
  showDocsIn: '显示“{name}”中的文件',
  hideDocsIn: '隐藏“{name}”中的文件',
  untitled: '（无标题）',
  selectedOf: '已选择 {n} / {total} 份文件',
  zipSize: ' · 合计约 {size}',
  estimating: ' · 正在估算大小…',
  starting: '启动中…',
  exportNDocs: '导出 {n} 份文件',

  exportProblem: '导出出现问题',
  lostTrack: '无法跟踪导出进度',
  expiredHint: '如提示“不存在或已过期”，说明该导出或下载文件已超过 24 小时。',
  backToDocs: '返回我的文件',
  startingExport: '正在启动导出…',
  preparingZip: '正在为您准备文件…',
  keepOpen: '请保持此页面打开，或将它加入书签，稍后再回来查看（24 小时内有效）。',
  progressDone: '已处理 {done} / {total} 份（{pct}%）',
  listing: '正在列出文件…',
  nFailed: ' · {n} 份失败',
  fetching: '正在获取：{file}',
  exportFailed: '导出失败',
  somethingWrong: '出了点问题',
  zipReady: '您的文件已准备就绪',
  doneDocs: '{total} 份文件中的 {n} 份',
  downloadZip: '立即下载',
  deletedAfter24h: '下载链接 24 小时内有效，之后文件将从服务器上删除。',
  couldNotFetch: '{n} 份文件获取失败',
  couldNotFetchOne: '{n} 份文件获取失败',
  exportSomethingElse: '导出其他文件',

  loadFailed: '文件加载失败',
  loginFailed: '登录失败',
  exportStartFailed: '无法启动导出',
};

const dict: Record<Lang, Record<TKey, string>> = { en, zh };

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
}

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void; t: (key: TKey, vars?: Record<string, string | number>) => string } | null>(
  null,
);

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    function setLang(l: Lang) {
      setLangState(l);
      try {
        localStorage.setItem(STORAGE_KEY, l);
      } catch {
        /* ignore storage failures — switch still works for the session */
      }
    }
    const t = (key: TKey, vars?: Record<string, string | number>) => interpolate(dict[lang][key], vars);
    return { lang, setLang, t };
  }, [lang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useT() {
  const ctx = useContext(LangContext);
  if (!ctx) throw new Error('useT must be used inside LangProvider');
  return ctx;
}
