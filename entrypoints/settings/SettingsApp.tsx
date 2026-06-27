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
import { t } from '@/lib/i18n';
import { manualKaikkiDownloadUrl } from '@/lib/kaikki';
import { clearKaikkiCache } from '@/lib/kaikki-cache';
import {
  DEFAULT_KAIKKI_SOURCE_URL,
  DEFAULT_SRS_SETTINGS,
  enableKaikki,
  recordKaikkiImport,
  resetKaikki,
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

type Message = { tone: 'success' | 'error'; text: string } | null;

export function SettingsApp() {
  const { settings, loading, mutate } = useSettings();
  const locale = settings.uiLocale;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [sourceUrl, setSourceUrl] = useState(settings.kaikki.sourceUrl);
  const [aiSettings, setAiSettingsState] = useState(DEFAULT_AI_SETTINGS);
  const [aiTesting, setAiTesting] = useState(false);
  const [aiTestResult, setAiTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [importProgress, setImportProgress] = useState<KaikkiImportProgress | null>(null);
  const [importPhase, setImportPhase] = useState<'idle' | 'parsing' | 'writing'>('idle');
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
      <header className="cinnabar-header-accent border-b-2 border-border-strong bg-paper-light">
        <div className="mx-auto max-w-4xl px-5 py-6">
          <a
            href={browser.runtime.getURL('/dashboard.html')}
            className="mb-5 inline-flex items-center gap-1 text-xs text-muted hover:text-cinnabar"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t(locale, 'settings.back')}
          </a>
          <div className="flex items-center gap-3">
            <img src={iconUrl} alt="" className="h-11 w-11 rounded-sm" aria-hidden="true" />
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
        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Globe2 className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.language')}</h2>
          </div>
          <select
            value={locale}
            onChange={(event) => updateLocale(event.target.value as UiLocale)}
            className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </section>

        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.defaultDictionary')}</h2>
          </div>
          <p className="text-xs leading-6 text-muted">{t(locale, 'settings.defaultDictionaryBody')}</p>
          <a
            href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-block text-xs text-muted hover:text-cinnabar"
          >
            {t(locale, 'dictionary.ccCedict')}
          </a>
        </section>

        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Database className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'dictionary.kaikki')}</h2>
          </div>
          <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.kaikkiBody')}</p>
          <p className="mb-3 rounded-sm border border-cinnabar-border bg-cinnabar-light px-3 py-2 text-xs leading-5 text-cinnabar">
            {t(locale, 'settings.kaikkiImportNotice')}
          </p>
          <label className="mb-3 flex items-center gap-2 text-sm text-ink-secondary">
            <input
              type="checkbox"
              checked={settings.kaikki.enabled}
              onChange={(event) => updateKaikkiEnabled(event.target.checked)}
              className="h-4 w-4 accent-cinnabar"
            />
            {t(locale, 'settings.enableKaikki')}
          </label>
          <label className="block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.sourceUrl')}
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
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
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Upload className="h-4 w-4" />
              {t(locale, 'settings.importFile')}
            </button>
            <button
              onClick={downloadKaikki}
              disabled={busy}
              className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2.5 text-sm text-white shadow-sm tracking-[1px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Download className="h-4 w-4" />
              {t(locale, 'settings.download')}
            </button>
            <button
              onClick={removeKaikki}
              disabled={busy || !settings.kaikki.hash}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[1px] transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar disabled:cursor-not-allowed disabled:opacity-60"
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
                  className="h-full bg-cinnabar transition-all"
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
                  className="rounded-sm border border-border bg-transparent px-2 py-1 text-xs text-ink-secondary transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar"
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

        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cinnabar" />
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
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
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
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
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
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
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
            className={`text-xs tracking-[1px] ${message.tone === 'error' ? 'text-cinnabar' : 'text-ink-secondary'}`}
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
