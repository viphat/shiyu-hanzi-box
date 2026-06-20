import { Download, FileText, Search } from 'lucide-react';
import { browser } from 'wxt/browser';
import { buildExportMap, exportInboxAsZip } from '@/lib/export';
import type { Inbox } from '@/lib/types';

export function Toolbar({
  inbox,
  query,
  onQuery,
}: {
  inbox: Inbox;
  query: string;
  onQuery: (query: string) => void;
}) {
  function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    return buffer;
  }

  async function downloadZip() {
    const bytes = await exportInboxAsZip(inbox);
    const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({
      url,
      filename: 'shiyu-hanzi-box-export.zip',
      saveAs: true,
    });
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({ url, filename: `${date}.md`, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 10000);
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
      </div>
    </div>
  );
}
