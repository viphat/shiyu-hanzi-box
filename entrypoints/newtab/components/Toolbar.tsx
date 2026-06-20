import { Download, FileText, Search, Upload } from 'lucide-react';
import { useRef, useState, type ChangeEvent } from 'react';
import { browser } from 'wxt/browser';
import { BackupParseError, parseBackup, serializeBackup } from '@/lib/backup';
import { buildExportMap, exportInboxAsZip } from '@/lib/export';
import type { Inbox } from '@/lib/types';

export function Toolbar({
  inbox,
  query,
  onQuery,
  onRestore,
}: {
  inbox: Inbox;
  query: string;
  onQuery: (query: string) => void;
  onRestore: (inbox: Inbox) => Promise<void> | void;
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

  async function downloadZip() {
    const bytes = await exportInboxAsZip(inbox);
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
    const map = buildExportMap(inbox.words, inbox.quotes);
    const md = map.get(`daily/${date}.md`) ?? `# ${date}\n\n_No entries today._\n`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    await downloadBlob(blob, `${date}.md`);
  }

  async function downloadBackup() {
    const json = serializeBackup(inbox);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    await downloadBlob(blob, `shiyu-hanzi-box-backup-${todayStamp()}.json`);
    setMessage({ tone: 'success', text: 'Backup JSON is ready.' });
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;

    setRestoring(true);
    setMessage(null);

    try {
      const restored = parseBackup(await file.text());
      const count = restored.words.length + restored.quotes.length;
      const confirmed = window.confirm(
        `Restore ${count} entries from "${file.name}"? This replaces the current local inbox.`,
      );

      if (!confirmed) return;

      await onRestore(restored);
      setMessage({
        tone: 'success',
        text: `Restored ${count} entries from backup.`,
      });
    } catch (error) {
      setMessage({
        tone: 'error',
        text:
          error instanceof BackupParseError
            ? error.message
            : 'Could not restore that backup file.',
      });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="rounded-lg border border-jade-100 bg-white p-3 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-jade-700">书桌工具</p>
          <p className="text-xs text-gray-400">
            Search your notes or export today&apos;s reading.
          </p>
        </div>
        <div className="rounded bg-jade-50 px-2 py-1 text-xs text-jade-700">
          {inbox.words.length} 词 · {inbox.quotes.length} 句
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-jade-500" />
          <input
            value={query}
            onChange={(event) => onQuery(event.target.value)}
            placeholder="Search words, quotes, categories..."
            className="w-full rounded-lg border border-jade-100 bg-[#fbfefc] py-2.5 pl-9 pr-3 text-sm outline-none focus:border-jade-400"
          />
        </div>
        <button
          onClick={downloadToday}
          className="inline-flex items-center gap-1 rounded-lg border border-jade-100 bg-white px-3 py-2.5 text-sm text-jade-800 hover:bg-jade-50"
        >
          <FileText className="h-4 w-4" /> Today
        </button>
        <button
          onClick={downloadZip}
          className="inline-flex items-center gap-1 rounded-lg bg-jade-700 px-3 py-2.5 text-sm text-white shadow-sm hover:bg-jade-800"
        >
          <Download className="h-4 w-4" /> Export zip
        </button>
        <button
          onClick={downloadBackup}
          className="inline-flex items-center gap-1 rounded-lg border border-jade-100 bg-white px-3 py-2.5 text-sm text-jade-800 hover:bg-jade-50"
        >
          <Download className="h-4 w-4" /> Backup
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
          className="inline-flex items-center gap-1 rounded-lg border border-jade-100 bg-white px-3 py-2.5 text-sm text-jade-800 hover:bg-jade-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Upload className="h-4 w-4" /> {restoring ? 'Restoring...' : 'Restore'}
        </button>
      </div>
      {message ? (
        <p
          className={`mt-3 text-xs ${
            message.tone === 'error' ? 'text-red-600' : 'text-jade-700'
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
