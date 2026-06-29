import type { Browser } from 'wxt/browser';
import {
  saveWord,
  saveQuote,
  type SourceInfo,
  type TaggedOutcome,
  type UndoCaptureMessage,
} from '@/lib/capture';
import { readPageContext, readPageMetadata } from '@/lib/page-context';
import { getSettings } from '@/lib/settings';
import { t } from '@/lib/i18n';
import {
  captureToastHeadline,
  truncateForToast,
  buildUndoMessage,
  renderCaptureToast,
  type CaptureToastArgs,
} from '@/lib/capture-toast';

export const MENU_SAVE_WORD = 'save-word-menu';
export const MENU_SAVE_QUOTE = 'save-quote-menu';
export const MENU_OPEN_DASHBOARD = 'open-dashboard';

export type CaptureResult =
  | { ok: true; outcome: TaggedOutcome | null; undo: UndoCaptureMessage | null }
  | { ok: false; reason: 'no-active-tab' | 'restricted-page' | 'no-selection' };

type ContextMenuInfo = Pick<Browser.contextMenus.OnClickData, 'selectionText'>;
type CaptureTab = Pick<Browser.tabs.Tab, 'title' | 'url'>;

async function capture(
  kind: 'word' | 'quote',
  text: string,
  src: SourceInfo,
): Promise<TaggedOutcome | null> {
  if (kind === 'word') {
    const o = await saveWord(text, src);
    return o ? { kind: 'word', ...o } : null;
  }
  const o = await saveQuote(text, src);
  return o ? { kind: 'quote', ...o } : null;
}

function okResult(outcome: TaggedOutcome | null, src: SourceInfo): CaptureResult {
  return { ok: true, outcome, undo: outcome ? buildUndoMessage(outcome, src) : null };
}

async function captureActiveTab(
  kind: 'word' | 'quote',
): Promise<{ result: CaptureResult; tabId: number | null; src: SourceInfo | null }> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { result: { ok: false, reason: 'no-active-tab' }, tabId: null, src: null };

  let ctx: Awaited<ReturnType<typeof readPageContext>> | null = null;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageContext,
    });
    ctx = res?.result ?? null;
  } catch {
    return { result: { ok: false, reason: 'restricted-page' }, tabId: tab.id, src: null };
  }

  if (!ctx || ctx.text.length === 0) {
    return { result: { ok: false, reason: 'no-selection' }, tabId: tab.id, src: null };
  }

  const src: SourceInfo = {
    sourceTitle: ctx.sourceTitle,
    sourceUrl: ctx.sourceUrl,
    sourceDomain: ctx.sourceDomain,
    surrounding: ctx.surrounding,
    capturedAt: Date.now(),
  };
  const outcome = await capture(kind, ctx.text, src);
  return { result: okResult(outcome, src), tabId: tab.id, src };
}

async function maybeShowToast(
  tabId: number,
  outcome: TaggedOutcome | null,
  undo: UndoCaptureMessage | null,
): Promise<void> {
  if (!outcome) return;
  const locale = (await getSettings()).uiLocale;
  const { headline, undoable } = captureToastHeadline(outcome.kind, outcome.action, locale);
  const args: CaptureToastArgs = {
    headline,
    text: truncateForToast(outcome.entry.text),
    undoLabel: t(locale, 'toast.undo'),
    undoneLabel: t(locale, 'toast.undone'),
    undoable,
    undoMessage: undoable ? undo : null,
  };
  try {
    await browser.scripting.executeScript({
      target: { tabId },
      func: renderCaptureToast,
      args: [args],
    });
  } catch {
    // Restricted page / injection failure — the badge is already shown.
  }
}

export async function handleCapture(kind: 'word' | 'quote'): Promise<CaptureResult> {
  const { result, tabId } = await captureActiveTab(kind);
  await setBadge(result.ok ? (kind === 'word' ? 'WORD' : 'QTE') : 'FAIL', result.ok);
  if (result.ok && tabId != null) {
    await maybeShowToast(tabId, result.outcome, result.undo);
  }
  return result;
}

export async function handleContextMenuCapture(
  kind: 'word' | 'quote',
  info: ContextMenuInfo,
  tab?: CaptureTab,
): Promise<CaptureResult> {
  const { result, tabId } = await captureActiveTab(kind);
  if (result.ok) {
    await setBadge(kind === 'word' ? 'WORD' : 'QTE', true);
    if (tabId != null) await maybeShowToast(tabId, result.outcome, result.undo);
    return result;
  }
  if (result.reason !== 'restricted-page') {
    await setBadge('FAIL', false);
    return result;
  }

  const text = info.selectionText?.trim() ?? '';
  if (!text) {
    await setBadge('FAIL', false);
    return result;
  }

  const src: SourceInfo = {
    sourceTitle: tab?.title ?? '',
    sourceUrl: tab?.url ?? '',
    sourceDomain: domainFromUrl(tab?.url),
    surrounding: '',
    capturedAt: Date.now(),
  };
  const outcome = await capture(kind, text, src);
  await setBadge(kind === 'word' ? 'WORD' : 'QTE', true);
  return okResult(outcome, src); // badge-only; restricted pages cannot host a toast
}

export async function handleManualCapture(
  kind: 'word' | 'quote',
  textInput: string,
): Promise<CaptureResult> {
  const text = textInput.trim();
  if (!text) {
    await setBadge('FAIL', false);
    return { ok: false, reason: 'no-selection' };
  }

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab) {
    await setBadge('FAIL', false);
    return { ok: false, reason: 'no-active-tab' };
  }

  const metadata = await pageMetadataForTab(tab);
  const src: SourceInfo = { ...metadata, surrounding: '', capturedAt: Date.now() };
  const outcome = await capture(kind, text, src);
  await setBadge(kind === 'word' ? 'WORD' : 'QTE', true);
  return okResult(outcome, src);
}

async function pageMetadataForTab(
  tab: CaptureTab & { id?: number },
): Promise<Omit<SourceInfo, 'surrounding' | 'capturedAt'>> {
  if (tab.id) {
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: readPageMetadata,
      });
      if (res?.result) return res.result;
    } catch {
      // Fall back to tab metadata below when page scripting is restricted.
    }
  }

  return {
    sourceTitle: tab.title ?? '',
    sourceUrl: tab.url ?? '',
    sourceDomain: domainFromUrl(tab.url),
  };
}

function domainFromUrl(url: string | undefined): string {
  if (!url) return '';
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

async function setBadge(label: string, ok: boolean): Promise<void> {
  const color = ok ? '#16a34a' : '#dc2626'; // jade / red
  await browser.action.setBadgeBackgroundColor({ color });
  await browser.action.setBadgeText({ text: label });
  await browser.action.setTitle({ title: ok ? 'Saved to 拾语汉字box' : 'Capture failed' });
  setTimeout(async () => {
    try {
      await browser.action.setBadgeText({ text: '' });
    } catch {
      /* sw may be asleep */
    }
  }, 1500);
}

// Keep the unused-import guard happy for the Tabs type re-export pattern.
export type ActiveTab = Browser.tabs.Tab;
