import { useState } from 'react';
import { Loader2, Quote, Type } from 'lucide-react';
import { handleCapture } from '@/entrypoints/background/capture-handler';

export function Popup() {
  const [busy, setBusy] = useState<'word' | 'quote' | null>(null);
  const [msg, setMsg] = useState<string>('');

  async function go(kind: 'word' | 'quote') {
    setBusy(kind);
    setMsg('');

    try {
      await handleCapture(kind);
      setMsg('Saved ✓');
    } catch {
      setMsg('Capture failed');
    } finally {
      setBusy(null);
      setTimeout(() => window.close(), 700);
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-sm font-semibold tracking-wide text-jade-700">拾语汉字box</h1>
      <p className="text-xs text-gray-500">Select text on the page, then choose how to save it.</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => go('word')}
          disabled={!!busy}
          className="flex flex-col items-center gap-1 rounded-lg border border-jade-200 bg-jade-50 px-3 py-3 text-xs font-medium text-jade-800 hover:bg-jade-100 disabled:opacity-50"
        >
          {busy === 'word' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Type className="h-4 w-4" />}
          Save as word
        </button>
        <button
          onClick={() => go('quote')}
          disabled={!!busy}
          className="flex flex-col items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
        >
          {busy === 'quote' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Quote className="h-4 w-4" />}
          Save as quote
        </button>
      </div>
      {msg && <p className="text-center text-xs text-gray-600">{msg}</p>}
    </div>
  );
}
