import { useEffect, useRef, useState } from 'react';
import { ClipboardPaste, Loader2, Quote, Type } from 'lucide-react';
import iconUrl from '../../assets/icon.png';
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
      setMsg('拾取失败');
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
      setMsg('拾取失败');
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
      setMsg('剪贴板读取受限。请把文字输入或拖入下方框中。');
    } finally {
      setBusy(null);
    }
  }

  function applyResult(kind: 'word' | 'quote', result: CaptureResult) {
    if (result.ok) {
      setManualKind(null);
      setMsg('已收好');
      setTimeout(() => window.close(), 700);
      return;
    }

    setManualKind(kind);
    setMsg(failureMessage(result.reason));
  }

  return (
    <div className="space-y-3 text-ink">
      <div className="flex items-center gap-2">
        <img
          src={iconUrl}
          alt=""
          className="h-8 w-8 rounded-sm"
          aria-hidden="true"
        />
        <h1 className="text-lg font-bold leading-none text-ink tracking-[4px]">
          拾语汉字box
        </h1>
      </div>
      <p className="text-[11px] leading-5 text-muted">选中文字，再决定收入词语还是句子。</p>
      <div className="grid gap-2">
        <button
          onClick={() => go('word')}
          disabled={!!busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-sm bg-cinnabar px-3 py-3 text-xs font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95 disabled:opacity-50"
        >
          {busy === 'word' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Type className="h-4 w-4" />}
          保存为词语
        </button>
        <button
          onClick={() => go('quote')}
          disabled={!!busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-sm border border-border bg-transparent px-3 py-3 text-xs font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input disabled:opacity-50"
        >
          {busy === 'quote' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Quote className="h-4 w-4" />}
          保存为句子
        </button>
      </div>
      {manualKind && (
        <div className="space-y-2 rounded-sm border border-border bg-paper-light p-2">
          <p className="text-xs leading-5 text-muted">
            当前页面限制读取选区。把文字贴在这里，也能照样收入。
          </p>
          <textarea
            ref={manualTextRef}
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder="粘贴选中的文字..."
            autoFocus
            rows={3}
            className="w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-cinnabar-fade"
          />
          <button
            onClick={() => pasteAndSave(manualKind)}
            disabled={!!busy}
            className="inline-flex w-full items-center justify-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input disabled:opacity-50"
          >
            <ClipboardPaste className="h-3.5 w-3.5" />
            从剪贴板粘贴并保存
          </button>
          <button
            onClick={() => saveManual(manualKind)}
            disabled={!!busy || manualText.trim().length === 0}
            className="w-full rounded-sm bg-cinnabar px-3 py-2 text-xs font-medium text-white shadow-sm tracking-[1px] transition hover:brightness-95 disabled:opacity-50"
          >
            保存粘贴的{manualKind === 'word' ? '词语' : '句子'}
          </button>
        </div>
      )}
      {msg && <p className="text-center text-xs text-muted tracking-[1px]">{msg}</p>}
    </div>
  );
}

function failureMessage(reason: 'no-active-tab' | 'restricted-page' | 'no-selection') {
  if (reason === 'no-selection') return '没有找到选中的文字';
  if (reason === 'restricted-page') return '当前页面不能拾取';
  return '没有找到活动标签页';
}
