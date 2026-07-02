import { t } from './i18n';
import type { UiLocale } from './types';
import type {
  WordAction,
  QuoteAction,
  TaggedOutcome,
  UndoCaptureMessage,
  SourceInfo,
} from './capture';
import { UNDO_CAPTURE_MESSAGE } from './capture';

export interface CaptureToastArgs {
  headline: string;
  /** Already-truncated display text. */
  text: string;
  undoLabel: string;
  undoneLabel: string;
  undoable: boolean;
  /** The message the Undo button sends; null when nothing was added. */
  undoMessage: UndoCaptureMessage | null;
}

/** Pick the headline + whether Undo is offered, given the captured action. */
export function captureToastHeadline(
  kind: 'word' | 'quote',
  action: WordAction | QuoteAction,
  locale: UiLocale,
): { headline: string; undoable: boolean } {
  if (action === 'duplicate') return { headline: t(locale, 'toast.duplicate'), undoable: false };
  if (kind === 'quote') return { headline: t(locale, 'toast.savedQuote'), undoable: true };
  if (action === 'occurrence-added') return { headline: t(locale, 'toast.savedOccurrence'), undoable: true };
  return { headline: t(locale, 'toast.savedWord'), undoable: true };
}

/** Truncate long capture text for display in the toast. */
export function truncateForToast(text: string, max = 40): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/** Build the runtime undo message for an outcome, or null when nothing is undoable. */
export function buildUndoMessage(
  outcome: TaggedOutcome,
  src: SourceInfo,
): UndoCaptureMessage | null {
  if (outcome.action === 'duplicate') return null;
  if (outcome.kind === 'quote') {
    return { type: UNDO_CAPTURE_MESSAGE, kind: 'quote', action: 'created', entryId: outcome.entry.id };
  }
  if (outcome.action === 'created') {
    return {
      type: UNDO_CAPTURE_MESSAGE, kind: 'word', action: 'created',
      entryId: outcome.entry.id, normalized: outcome.entry.normalized,
    };
  }
  // occurrence-added
  return {
    type: UNDO_CAPTURE_MESSAGE, kind: 'word', action: 'occurrence-added',
    entryId: outcome.entry.id, normalized: outcome.entry.normalized,
    occurrence: { sourceUrl: src.sourceUrl, surrounding: src.surrounding, capturedAt: src.capturedAt },
  };
}

/**
 * Self-contained toast renderer injected via scripting.executeScript.
 * MUST NOT reference any import/closure — all data arrives via `args`.
 * Runs in the isolated content world (has `document` and `chrome`).
 */
export function renderCaptureToast(args: CaptureToastArgs): void {
  const HOST_ID = 'shiyu-capture-toast';
  const existing = document.getElementById(HOST_ID);
  if (existing) existing.remove();

  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.position = 'fixed';
  host.style.bottom = '20px';
  host.style.right = '20px';
  host.style.zIndex = '2147483647';
  const root = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = [
    '.card{font-family:system-ui,-apple-system,sans-serif;background:#fdfbf4;color:#40392f;',
    'border:1px solid #e8dfca;border-left:4px solid #7d9070;border-radius:14px;',
    'box-shadow:0 6px 24px rgba(90,75,50,.16);padding:12px 14px;max-width:320px;',
    'display:flex;flex-direction:column;gap:6px;animation:shiyuIn .18s ease-out}',
    '.headline{font-size:12px;letter-spacing:.5px;color:#54704a;font-weight:600}',
    '.text{font-size:14px;line-height:1.4;word-break:break-word}',
    '.actions{display:flex;justify-content:flex-end;margin-top:2px}',
    'button{font:inherit;font-size:12px;cursor:pointer;border:1px solid #d3ddc4;',
    'background:transparent;color:#54704a;border-radius:999px;padding:4px 12px}',
    'button:hover{background:#eef2e6}',
    '@keyframes shiyuIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}',
  ].join('');
  root.appendChild(style);

  const card = document.createElement('div');
  card.className = 'card';

  const headline = document.createElement('div');
  headline.className = 'headline';
  headline.textContent = args.headline;
  card.appendChild(headline);

  const text = document.createElement('div');
  text.className = 'text';
  text.textContent = args.text;
  card.appendChild(text);

  let dismissed = false;
  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    host.remove();
  };
  let timer = setTimeout(dismiss, 6000);

  if (args.undoable && args.undoMessage) {
    const actions = document.createElement('div');
    actions.className = 'actions';
    const undo = document.createElement('button');
    undo.setAttribute('data-undo', '');
    undo.textContent = args.undoLabel;
    undo.addEventListener('click', () => {
      clearTimeout(timer);
      // Cast to access the `chrome` global present in the content-script world.
      // No module-level import — this function is serialized and injected.
      const cr = (globalThis as unknown as { chrome: { runtime: { sendMessage(msg: unknown, cb?: () => void): void } } }).chrome;
      cr.runtime.sendMessage(args.undoMessage, () => {
        headline.textContent = args.undoneLabel;
        undo.remove();
        timer = setTimeout(dismiss, 1200);
      });
    });
    actions.appendChild(undo);
    card.appendChild(actions);
  }

  root.appendChild(card);
  document.body.appendChild(host);
}
