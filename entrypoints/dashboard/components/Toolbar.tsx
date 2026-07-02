import { Download, FileText, Search, Settings, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import { BackupParseError, restoreFullBackup, serializeFullBackup } from '@/lib/backup';
import { loadDictionary } from '@/lib/dictionary-loader';
import { buildExportMap, exportInboxAsZip } from '@/lib/export';
import { formatMessage, t } from '@/lib/i18n';
import type { AiSettings, AppSettings, Inbox, UiLocale } from '@/lib/types';

export function Toolbar({
  inbox,
  query,
  onQuery,
  onRestore,
  locale,
  settings,
  aiSettings,
}: {
  inbox: Inbox;
  query: string;
  onQuery: (query: string) => void;
  onRestore: (restored: { inbox: Inbox; settings?: AppSettings; aiSettings?: AiSettings }) => Promise<void> | void;
  locale: UiLocale;
  settings: AppSettings;
  aiSettings: AiSettings;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{
    tone: 'success' | 'error';
    text: string;
  } | null>(null);

  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  async function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    try {
      await browser.downloads.download({ url, filename, saveAs: true });
    } finally {
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  }

  async function dictionaryIndexForExport() {
    const result = await loadDictionary();
    return result.index;
  }

  async function downloadZip() {
    const index = await dictionaryIndexForExport();
    const bytes = await exportInboxAsZip(inbox, index);
    const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/zip' });
    await downloadBlob(blob, 'shiyu-hanzi-box-export.zip');
  }

  async function downloadToday() {
    const today = new Date();
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const index = await dictionaryIndexForExport();
    const map = buildExportMap(inbox.words, inbox.quotes, index);
    const md = map.get(`daily/${date}.md`) ?? `# ${date}\n\n_No entries today._\n`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    await downloadBlob(blob, `${date}.md`);
  }

  async function downloadBackup() {
    const confirmed = window.confirm(t(locale, 'sync.warn.backupUnencrypted'));
    if (!confirmed) return;
    const json = serializeFullBackup(inbox, settings, aiSettings);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    await downloadBlob(blob, `shiyu-hanzi-box-backup-${todayStamp()}.json`);
    setMessage({ tone: 'success', text: t(locale, 'toolbar.backupReady') });
  }

  function openSettings() {
    browser.tabs.create({ url: browser.runtime.getURL('/settings.html') });
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setRestoring(true);
    setMessage(null);

    try {
      const restored = restoreFullBackup(await file.text());
      const count = restored.inbox.words.length + restored.inbox.quotes.length;
      const confirmed = window.confirm(
        formatMessage(locale, 'toolbar.restoreConfirm', { count, name: file.name }),
      );

      if (!confirmed) return;

      await onRestore(restored);
      setMessage({
        tone: 'success',
        text: formatMessage(locale, 'toolbar.restoreSuccess', { count }),
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof BackupParseError
            ? error.message
            : t(locale, 'toolbar.restoreFailed'),
      });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-3 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-ink-secondary tracking-[1px]">
            {t(locale, 'toolbar.title')}
          </p>
          <p className="mt-1 text-xs text-muted">
            {t(locale, 'toolbar.subtitle')}
          </p>
        </div>
        <div className="rounded-full border border-accent-border bg-accent-tint px-3 py-1 text-xs text-accent-deep tracking-[1px]">
          {inbox.words.length} {t(locale, 'toolbar.wordCount')} · {inbox.quotes.length} {t(locale, 'toolbar.quoteCount')}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder={t(locale, 'toolbar.searchPlaceholder')}
            className="w-full rounded-full border border-border bg-card-soft py-2.5 pl-10 pr-4 text-sm text-ink outline-none transition placeholder:text-muted focus:border-accent-fade"
          />
        </div>
        <button
          onClick={downloadToday}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
        >
          <FileText className="h-4 w-4" /> {t(locale, 'toolbar.todayNote')}
        </button>
        <button
          onClick={downloadZip}
          className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-2.5 text-sm text-white shadow-sm tracking-[2px] transition hover:brightness-95"
        >
          <Download className="h-4 w-4" /> {t(locale, 'toolbar.export')}
        </button>
        <button
          onClick={downloadBackup}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
        >
          <Download className="h-4 w-4" /> {t(locale, 'toolbar.backup')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={restoreBackup}
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={restoring}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload className="h-4 w-4" /> {restoring ? t(locale, 'toolbar.restoring') : t(locale, 'toolbar.restore')}
        </button>
        <button
          onClick={openSettings}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
        >
          <Settings className="h-4 w-4" /> {t(locale, 'toolbar.settings')}
        </button>
      </div>
      {message ? (
        <p
          className={`mt-3 text-xs tracking-[1px] ${
            message.tone === 'error' ? 'text-accent-deep' : 'text-ink-secondary'
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function todayStamp(date = new Date()): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}
