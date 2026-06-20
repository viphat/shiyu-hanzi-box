import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Loader2, Quote, Type } from 'lucide-react';
import {
  handleCapture,
  handleManualCapture,
  type CaptureResult,
} from '@/entrypoints/background/capture-handler';

export function Popup() {
  const [busy, setBusy] = useState<'word' | 'quote' | null>(null);
  const [msg, setMsg] = useState<string>('');
  const [manualText, setManualText] = useState('');
  const [manualKind, setManualKind] = useState<'word' | 'quote' | null>(null);
  const manualTextRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (manualKind) manualTextRef.current?.focus();
  }, [manualKind]);

  async function go(kind: 'word' | 'quote') {
    setBusy(kind);
    setMsg('');

    try {
      const result = await handleCapture(kind);
      applyResult(kind, result);
    } catch {
      setMsg('Capture failed');
    } finally {
      setBusy(null);
    }
  }

  async function saveManual(kind: 'word' | 'quote') {
    setBusy(kind);
    setMsg('');

    try {
      const result = await handleManualCapture(kind, manualText);
      applyResult(kind, result);
      if (result.ok) setManualText('');
    } catch {
      setMsg('Capture failed');
    } finally {
      setBusy(null);
    }
  }

  async function pasteAndSave(kind: 'word' | 'quote') {
    setBusy(kind);
    setMsg('');

    try {
      const text = await navigator.clipboard.readText();
      setManualText(text);
      const result = await handleManualCapture(kind, text);
      applyResult(kind, result);
      if (result.ok) setManualText('');
    } catch {
      setMsg('Clipboard paste blocked. Type or drag text into the box.');
    } finally {
      setBusy(null);
    }
  }

  function applyResult(kind: 'word' | 'quote', result: CaptureResult) {
    if (result.ok) {
      setManualKind(null);
      setMsg('Saved ✓');
      setTimeout(() => window.close(), 700);
      return;
    }

    setManualKind(kind);
    setMsg(failureMessage(result.reason));
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
      {manualKind && (
        <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-2">
          <p className="text-xs text-gray-500">
            Atlas blocked page selection access. Paste the text here to save it.
          </p>
          <textarea
            ref={manualTextRef}
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="Paste selected text..."
            autoFocus
            rows={3}
            className="w-full resize-none rounded border bg-white p-2 text-xs outline-none focus:border-jade-400"
          />
          <button
            onClick={() => pasteAndSave(manualKind)}
            disabled={!!busy}
            className="inline-flex w-full items-center justify-center gap-1 rounded-lg border bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-100 disabled:opacity-50"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            Paste from clipboard and save
          </button>
          <button
            onClick={() => saveManual(manualKind)}
            disabled={!!busy || manualText.trim().length === 0}
            className="w-full rounded-lg bg-jade-600 px-3 py-2 text-xs font-medium text-white hover:bg-jade-700 disabled:opacity-50"
          >
            Save pasted {manualKind}
          </button>
        </div>
      )}
      {msg && <p className="text-center text-xs text-gray-600">{msg}</p>}
    </div>
  );
}

function failureMessage(reason: 'no-active-tab' | 'restricted-page' | 'no-selection') {
  if (reason === 'no-selection') return 'No selected text found';
  if (reason === 'restricted-page') return 'Cannot capture on this page';
  return 'No active tab found';
}
