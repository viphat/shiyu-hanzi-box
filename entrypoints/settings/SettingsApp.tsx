import {
  ArrowLeft,
  Database,
  Download,
  Gauge,
  Globe2,
  Trash2,
  Upload,
} from 'lucide-react';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import iconUrl from '../../assets/icon.png';
import { testAiConnection as testAiProviderConnection } from '@/lib/ai/client';
import { requestAiSettingsPermission } from '@/lib/ai/permissions';
import { DEFAULT_AI_SETTINGS, getAiSettings } from '@/lib/ai/settings';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import { clearCvdictCache } from '@/lib/cvdict-cache';
import { t } from '@/lib/i18n';
import { manualKaikkiDownloadUrl } from '@/lib/kaikki';
import { clearKaikkiCache } from '@/lib/kaikki-cache';
import {
  DEFAULT_KAIKKI_SOURCE_URL,
  DEFAULT_SRS_SETTINGS,
  enableKaikki,
  recordCvdictInstall,
  recordKaikkiImport,
  resetCvdict,
  resetKaikki,
  setCvdictEnabled,
  setSrsSettings,
  setUiLocale,
} from '@/lib/settings';
import type { AiSettings, UiLocale } from '@/lib/types';
import { useSettings } from '../dashboard/hooks/useSettings';
import { AiSettingsPanel } from './AiSettingsPanel';
import { FolderSync } from './FolderSync';
import type {
  KaikkiImportProgress,
  KaikkiImportWorkerRequest,
  KaikkiImportWorkerResponse,
} from './kaikki-import-types';
import type {
  CvdictInstallWorkerRequest,
  CvdictInstallWorkerResponse,
} from './cvdict-install-types';

type Message = { tone: 'success' | 'error'; text: string } | null;

export function SettingsApp() {
  const { settings, loading, mutate } = useSettings();
  const locale = settings.uiLocale;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const cvdictWorkerRef = useRef<Worker | null>(null);
  const [sourceUrl, setSourceUrl] = useState(settings.kaikki.sourceUrl);
  const [aiSettings, setAiSettingsState] = useState(DEFAULT_AI_SETTINGS);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [cvdictBusy, setCvdictBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<KaikkiImportProgress | null>(null);
  const [importPhase, setImportPhase] = useState<'idle' | 'parsing' | 'writing'>('idle');
  const [cvdictProgress, setCvdictProgress] = useState<Extract<
    CvdictInstallWorkerResponse,
    { type: 'progress' | 'indexing' }
  > | null>(null);
  const [message, setMessage] = useState<Message>(null);

  useEffect(() => {
    setSourceUrl(settings.kaikki.sourceUrl);
  }, [settings.kaikki.sourceUrl]);

  useEffect(() => {
    let mounted = true;
    getAiSettings().then((next) => {
      if (!mounted) return;
      setAiSettingsState(next);
    });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      cvdictWorkerRef.current?.terminate();
    };
  }, []);

  if (loading) {
    return <div className="min-h-screen p-8 text-sm text-ink-secondary">{t('zh-CN', 'app.loading')}</div>;
  }

  async function updateLocale(uiLocale: UiLocale) {
    await mutate((current) => setUiLocale(current, uiLocale));
    setMessage({ tone: 'success', text: t(uiLocale, 'settings.saved') });
  }

  async function updateKaikkiEnabled(enabled: boolean) {
    await mutate((current) => enableKaikki(current, enabled));
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
  }

  function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    startKaikkiImport(file, {
      sourceUrl: sourceUrl || settings.kaikki.sourceUrl,
      sourceName: file.name,
    });
  }

  function downloadKaikki() {
    const target = manualKaikkiDownloadUrl(sourceUrl);
    if (!target) {
      setMessage({ tone: 'error', text: t(locale, 'settings.invalidKaikkiUrl') });
      return;
    }

    browser.tabs.create({ url: target });
    setMessage({ tone: 'success', text: t(locale, 'settings.downloadOpened') });
  }

  function startKaikkiImport(
    file: File,
    source: { sourceUrl: string; sourceName: string },
  ) {
    workerRef.current?.terminate();
    const worker = new Worker(new URL('./kaikki-import.worker.ts', import.meta.url), {
      type: 'module',
    });
    workerRef.current = worker;
    setBusy(true);
    setImportPhase('parsing');
    setImportProgress({
      loadedBytes: 0,
      totalBytes: file.size,
      percent: 0,
      entryCount: 0,
      skipped: 0,
    });
    setMessage(null);

    worker.onmessage = (event: MessageEvent<KaikkiImportWorkerResponse>) => {
      void handleKaikkiWorkerMessage(event.data, source);
    };
    worker.onerror = () => {
      finishKaikkiImport();
      setMessage({ tone: 'error', text: t(locale, 'settings.failed') });
    };

    const request: KaikkiImportWorkerRequest = { type: 'import', file };
    worker.postMessage(request);
  }

  async function handleKaikkiWorkerMessage(
    workerMessage: KaikkiImportWorkerResponse,
    source: { sourceUrl: string; sourceName: string },
  ) {
    if (workerMessage.type === 'progress') {
      setImportPhase('parsing');
      setImportProgress(workerMessage);
      return;
    }

    if (workerMessage.type === 'writing') {
      setImportPhase('writing');
      setImportProgress(workerMessage);
      return;
    }

    if (workerMessage.type === 'complete') {
      await mutate((current) =>
        recordKaikkiImport(current, {
          sourceUrl: source.sourceUrl,
          sourceName: source.sourceName,
          hash: workerMessage.hash,
          entryCount: workerMessage.entryCount,
          importedAt: Date.now(),
        }),
      );
      finishKaikkiImport();
      setMessage({
        tone: 'success',
        text: `${t(locale, 'settings.ready')}: ${workerMessage.entryCount}`,
      });
      return;
    }

    finishKaikkiImport();
    if (workerMessage.type === 'cancelled') {
      setMessage({ tone: 'success', text: t(locale, 'settings.importCancelled') });
    } else {
      setMessage({ tone: 'error', text: t(locale, 'settings.failed') });
    }
  }

  function cancelKaikkiImport() {
    const request: KaikkiImportWorkerRequest = { type: 'cancel' };
    workerRef.current?.postMessage(request);
    finishKaikkiImport();
    setMessage({ tone: 'success', text: t(locale, 'settings.importCancelled') });
  }

  function finishKaikkiImport() {
    workerRef.current?.terminate();
    workerRef.current = null;
    setBusy(false);
    setImportPhase('idle');
    setImportProgress(null);
  }

  async function removeKaikki() {
    const hash = settings.kaikki.hash;
    if (hash) await clearKaikkiCache(hash);
    await mutate((current) => resetKaikki(current));
    setSourceUrl(DEFAULT_KAIKKI_SOURCE_URL);
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
  }

  async function updateCvdictEnabled(enabled: boolean) {
    await mutate((current) => setCvdictEnabled(current, enabled));
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
  }

  async function startCvdictInstall() {
    let granted = false;
    try {
      granted = await browser.permissions.request({
        origins: ['https://raw.githubusercontent.com/*'],
      });
    } catch {
      setMessage({ tone: 'error', text: t(locale, 'settings.cvdictPermissionDenied') });
      return;
    }
    if (!granted) {
      setMessage({ tone: 'error', text: t(locale, 'settings.cvdictPermissionDenied') });
      return;
    }

    cvdictWorkerRef.current?.terminate();
    const worker = new Worker(new URL('./cvdict-install.worker.ts', import.meta.url), {
      type: 'module',
    });
    cvdictWorkerRef.current = worker;
    setCvdictBusy(true);
    setCvdictProgress({
      type: 'progress',
      loadedBytes: 0,
      totalBytes: null,
      entryCount: 0,
      skipped: 0,
    });
    setMessage(null);

    worker.onmessage = (event: MessageEvent<CvdictInstallWorkerResponse>) => {
      void handleCvdictWorkerMessage(event.data);
    };
    worker.onerror = () => {
      finishCvdictInstall();
      setMessage({ tone: 'error', text: t(locale, 'settings.failed') });
    };

    const request: CvdictInstallWorkerRequest = { type: 'install' };
    worker.postMessage(request);
  }

  async function handleCvdictWorkerMessage(workerMessage: CvdictInstallWorkerResponse) {
    if (workerMessage.type === 'progress' || workerMessage.type === 'indexing') {
      setCvdictProgress(workerMessage);
      return;
    }

    if (workerMessage.type === 'complete') {
      await mutate((current) =>
        recordCvdictInstall(current, {
          hash: workerMessage.hash,
          entryCount: workerMessage.entryCount,
          version: workerMessage.version,
          release: workerMessage.release,
          installedAt: Date.now(),
        }),
      );
      finishCvdictInstall();
      setMessage({
        tone: 'success',
        text: `${t(locale, 'settings.ready')}: ${workerMessage.entryCount}`,
      });
      return;
    }

    finishCvdictInstall();
    if (workerMessage.type === 'cancelled') {
      setMessage({ tone: 'success', text: t(locale, 'settings.importCancelled') });
      return;
    }
    setMessage({
      tone: 'error',
      text: workerMessage.code === 'too-large'
        ? t(locale, 'settings.cvdictTooLarge')
        : workerMessage.code === 'invalid-data'
          ? t(locale, 'settings.cvdictNoEntries')
          : t(locale, 'settings.failed'),
    });
  }

  function cancelCvdictInstall() {
    const request: CvdictInstallWorkerRequest = { type: 'cancel' };
    cvdictWorkerRef.current?.postMessage(request);
  }

  function finishCvdictInstall() {
    cvdictWorkerRef.current?.terminate();
    cvdictWorkerRef.current = null;
    setCvdictBusy(false);
    setCvdictProgress(null);
  }

  async function removeCvdict() {
    const hash = settings.cvdict.hash;
    if (hash) await clearCvdictCache(hash);
    await mutate((current) => resetCvdict(current));
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
  }

  async function saveAiSettings(next: AiSettings): Promise<boolean> {
    setMessage(null);
    const granted = await requestAiSettingsPermission(next);
    if (!granted) {
      setAiTestResult({ ok: false, message: 'Provider permission was not granted.' });
      return false;
    }
    await requestSyncMutation('ai', next);
    setAiSettingsState(next);
    setMessage({ tone: 'success', text: t(locale, 'settings.saved') });
    return true;
  }

  async function testAiConnection(next: AiSettings): Promise<{ ok: boolean; message: string }> {
    setAiTesting(true);
    setAiTestResult(null);
    try {
      const granted = await requestAiSettingsPermission({ ...next, enabled: true });
      if (!granted) {
        const denied = { ok: false, message: 'Provider permission was not granted.' };
        setAiTestResult(denied);
        return denied;
      }

      const result = await testAiProviderConnection({
        baseUrl: next.baseUrl,
        apiKey: next.apiKey,
        model: next.model,
        provider: next.provider,
      });
      const display = { ok: result.ok, message: result.message };
      setAiTestResult(display);
      return display;
    } catch {
      const failed = { ok: false, message: '连接失败' };
      setAiTestResult(failed);
      return failed;
    } finally {
      setAiTesting(false);
    }
  }

  return (
    <div className="min-h-screen text-ink">
      <header className="border-b border-border-soft bg-banner">
        <div className="mx-auto max-w-4xl px-5 py-6">
          <a
            href={browser.runtime.getURL('/dashboard.html')}
            className="mb-5 inline-flex items-center gap-1 text-xs text-muted hover:text-accent-deep"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t(locale, 'settings.back')}
          </a>
          <div className="flex items-center gap-3">
            <img src={iconUrl} alt="" className="h-11 w-11 rounded-[14px]" aria-hidden="true" />
            <div>
              <h1 className="text-[26px] font-bold leading-none text-ink tracking-[5px]">
                {t(locale, 'settings.title')}
              </h1>
              <p className="mt-2 text-xs leading-6 text-muted tracking-[1px]">
                {t(locale, 'settings.kaikkiBody')}
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-5 px-5 py-6">
        <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-accent-deep" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.language')}</h2>
          </div>
          <select
            value={locale}
            onChange={(event) => updateLocale(event.target.value as UiLocale)}
            className="rounded-md border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-fade"
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-accent-deep" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.defaultDictionary')}</h2>
          </div>
          <p className="text-xs leading-6 text-muted">{t(locale, 'settings.defaultDictionaryBody')}</p>
          <a
            href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-muted hover:text-accent-deep"
          >
            {t(locale, 'dictionary.ccCedict')}
          </a>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-accent-deep" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'dictionary.kaikki')}</h2>
          </div>
          <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.kaikkiBody')}</p>
          <p className="mb-3 rounded-md border border-accent-border bg-accent-tint px-3 py-2 text-xs leading-5 text-accent-deep">
            {t(locale, 'settings.kaikkiImportNotice')}
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={settings.kaikki.enabled}
              onChange={(event) => updateKaikkiEnabled(event.target.checked)}
              className="h-4 w-4 accent-accent"
            />
            {t(locale, 'settings.enableKaikki')}
          </label>
          <label className="block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.sourceUrl')}
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-fade"
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".jsonl,application/jsonl,application/json,text/plain"
              className="hidden"
              onChange={importFile}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {t(locale, 'settings.importFile')}
            </button>
            <button
              onClick={downloadKaikki}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-2.5 text-sm text-white shadow-sm tracking-[1px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {t(locale, 'settings.download')}
            </button>
            <button
              onClick={removeKaikki}
              disabled={busy || !settings.kaikki.hash}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-accent-border hover:bg-accent-light hover:text-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {t(locale, 'settings.removeKaikki')}
            </button>
          </div>
          {importProgress ? (
            <div className="mt-3 rounded-sm border border-border bg-paper-input p-3 text-xs text-muted">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink-secondary">
                  {importPhase === 'writing'
                    ? t(locale, 'settings.writingDictionary')
                    : t(locale, 'settings.importing')}
                </span>
                <span>
                  {formatBytes(importProgress.loadedBytes)} / {formatBytes(importProgress.totalBytes)} · {importProgress.percent}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-sm bg-border">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${importProgress.percent}%` }}
                />
              </div>
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                <span>
                  {t(locale, 'settings.importedEntries')}: {importProgress.entryCount} · {t(locale, 'settings.filteredRecords')}: {importProgress.skipped}
                </span>
                <button
                  type="button"
                  onClick={cancelKaikkiImport}
                  className="rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-ink-secondary transition hover:border-accent-border hover:bg-accent-light hover:text-accent-deep"
                >
                  {t(locale, 'settings.cancelImport')}
                </button>
              </div>
            </div>
          ) : null}
          <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-3">
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.importedEntries')}</dt>
              <dd className="mt-0.5 text-ink-secondary">{settings.kaikki.entryCount || t(locale, 'settings.notImported')}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>Hash</dt>
              <dd className="mt-0.5 truncate text-ink-secondary">{settings.kaikki.hash ?? '-'}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.ready')}</dt>
              <dd className="mt-0.5 text-ink-secondary">
                {settings.kaikki.importedAt
                  ? new Intl.DateTimeFormat(locale).format(new Date(settings.kaikki.importedAt))
                  : t(locale, 'settings.notImported')}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-accent-deep" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'dictionary.cvdict')}</h2>
          </div>
          <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.cvdictBody')}</p>
          <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.cvdictSource')}</p>
          {settings.cvdict.hash ? (
            <label className="mb-3 flex items-center gap-2 text-sm text-ink-secondary">
              <input
                type="checkbox"
                checked={settings.cvdict.enabled}
                onChange={(event) => updateCvdictEnabled(event.target.checked)}
                disabled={cvdictBusy}
                className="h-4 w-4 accent-accent"
              />
              {t(locale, 'settings.enableCvdict')}
            </label>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={startCvdictInstall}
              disabled={cvdictBusy}
              className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-2.5 text-sm text-white shadow-sm tracking-[1px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {settings.cvdict.hash
                ? t(locale, 'settings.updateCvdict')
                : t(locale, 'settings.installEnableCvdict')}
            </button>
            <button
              onClick={removeCvdict}
              disabled={cvdictBusy || !settings.cvdict.hash}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-accent-border hover:bg-accent-light hover:text-accent-deep disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" />
              {t(locale, 'settings.removeCvdict')}
            </button>
          </div>
          {cvdictProgress ? (
            <div className="mt-3 rounded-sm border border-border bg-paper-input p-3 text-xs text-muted">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-ink-secondary">
                  {cvdictProgress.type === 'indexing'
                    ? t(locale, 'settings.cvdictIndexing')
                    : t(locale, 'settings.cvdictDownloading')}
                </span>
                {cvdictProgress.type === 'progress' ? (
                  <span>
                    {formatBytes(cvdictProgress.loadedBytes)} / {cvdictProgress.totalBytes === null
                      ? '?'
                      : formatBytes(cvdictProgress.totalBytes)}
                  </span>
                ) : null}
              </div>
              <div>
                {t(locale, 'settings.cvdictInstalledEntries')}: {cvdictProgress.entryCount} · {t(locale, 'settings.filteredRecords')}: {cvdictProgress.skipped}
              </div>
              <button
                type="button"
                onClick={cancelCvdictInstall}
                className="mt-2 rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-ink-secondary transition hover:border-accent-border hover:bg-accent-light hover:text-accent-deep"
              >
                {t(locale, 'settings.cancelImport')}
              </button>
            </div>
          ) : null}
          <dl className="mt-3 grid gap-2 text-xs text-muted sm:grid-cols-4">
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.cvdictInstalledEntries')}</dt>
              <dd className="mt-0.5 text-ink-secondary">{settings.cvdict.entryCount || t(locale, 'settings.cvdictNotInstalled')}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.cvdictVersion')}</dt>
              <dd className="mt-0.5 text-ink-secondary">{settings.cvdict.version ?? '-'}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.cvdictRelease')}</dt>
              <dd className="mt-0.5 truncate text-ink-secondary">{settings.cvdict.release ?? '-'}</dd>
            </div>
            <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
              <dt>{t(locale, 'settings.cvdictInstalledAt')}</dt>
              <dd className="mt-0.5 text-ink-secondary">
                {settings.cvdict.installedAt
                  ? new Intl.DateTimeFormat(locale).format(new Date(settings.cvdict.installedAt))
                  : t(locale, 'settings.cvdictNotInstalled')}
              </dd>
            </div>
          </dl>
        </section>

        <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
          <div className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-accent-deep" />
            <h2 className="text-sm font-semibold tracking-[2px]">
              {t(locale, 'settings.srs')}
            </h2>
          </div>
          <p className="mb-3 text-xs leading-6 text-muted">
            {t(locale, 'settings.srsDesiredRetentionHint')}
          </p>

          <label className="block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.srsDesiredRetention')}
            <select
              value={String(settings.srs.desiredRetention)}
              onChange={(event) =>
                mutate((current) =>
                  setSrsSettings(current, {
                    ...current.srs,
                    desiredRetention: Number(event.target.value),
                  }),
                )
              }
              className="mt-1 w-full rounded-md border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-fade"
            >
              {[0.8, 0.85, 0.9, 0.92, 0.95, 0.97].map((value) => (
                <option key={value} value={value}>
                  {Math.round(value * 100)}%
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.srsMaxInterval')}
            <input
              type="number"
              min={1}
              value={settings.srs.maximumIntervalDays}
              onChange={(event) =>
                mutate((current) =>
                  setSrsSettings(current, {
                    ...current.srs,
                    maximumIntervalDays: Math.max(
                      1,
                      Number(event.target.value) ||
                        DEFAULT_SRS_SETTINGS.maximumIntervalDays,
                    ),
                  }),
                )
              }
              className="mt-1 w-full rounded-md border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-fade"
            />
          </label>

          <label className="mt-3 block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.srsNewPerDay')}
            <input
              type="number"
              min={0}
              value={settings.srs.newCardsPerDay}
              onChange={(event) =>
                mutate((current) =>
                  setSrsSettings(current, {
                    ...current.srs,
                    newCardsPerDay: Math.max(
                      0,
                      Number(event.target.value) || 0,
                    ),
                  }),
                )
              }
              className="mt-1 w-full rounded-md border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-accent-fade"
            />
          </label>
        </section>

        <AiSettingsPanel
          settings={aiSettings}
          onSave={saveAiSettings}
          onTestConnection={testAiConnection}
          testing={aiTesting}
          testResult={aiTestResult}
        />

        <FolderSync locale={locale} />

        {message ? (
          <p
            role="status"
            className={`text-xs tracking-[1px] ${message.tone === 'error' ? 'text-accent-deep' : 'text-ink-secondary'}`}
          >
            {message.text}
          </p>
        ) : null}
      </main>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}
