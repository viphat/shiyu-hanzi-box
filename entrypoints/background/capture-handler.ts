import type { Browser } from 'wxt/browser';
import { saveWord, saveQuote, type SourceInfo } from '@/lib/capture';
import { readPageContext, readPageMetadata } from '@/lib/page-context';

export const MENU_SAVE_WORD = 'save-word-menu';
export const MENU_SAVE_QUOTE = 'save-quote-menu';

export type CaptureResult =
  | { ok: true }
  | { ok: false; reason: 'no-active-tab' | 'restricted-page' | 'no-selection' };

type ContextMenuInfo = Pick<Browser.contextMenus.OnClickData, 'selectionText'>;
type CaptureTab = Pick<Browser.tabs.Tab, 'title' | 'url'>;

async function captureActiveTab(kind: 'word' | 'quote'): Promise<CaptureResult> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return { ok: false, reason: 'no-active-tab' };

  let ctx: Awaited<ReturnType<typeof readPageContext>> | null = null;
  try {
    const [res] = await browser.scripting.executeScript({
      target: { tabId: tab.id },
      func: readPageContext,
    });
    ctx = res?.result ?? null;
  } catch (e) {
    return { ok: false, reason: 'restricted-page' };
  }

  if (!ctx || ctx.text.length === 0) return { ok: false, reason: 'no-selection' };

  const src: SourceInfo = {
    sourceTitle: ctx.sourceTitle,
    sourceUrl: ctx.sourceUrl,
    sourceDomain: ctx.sourceDomain,
    surrounding: ctx.surrounding,
    capturedAt: Date.now(),
  };

  if (kind === 'word') await saveWord(ctx.text, src);
  else await saveQuote(ctx.text, src);

  return { ok: true };
}

export async function handleCapture(kind: 'word' | 'quote'): Promise<CaptureResult> {
  const result = await captureActiveTab(kind);
  await setBadge(result.ok ? (kind === 'word' ? 'WORD' : 'QTE') : 'FAIL', result.ok);
  return result;
}

export async function handleContextMenuCapture(
  kind: 'word' | 'quote',
  info: ContextMenuInfo,
  tab?: CaptureTab,
): Promise<CaptureResult> {
  const result = await captureActiveTab(kind);
  if (result.ok || result.reason !== 'restricted-page') {
    await setBadge(result.ok ? (kind === 'word' ? 'WORD' : 'QTE') : 'FAIL', result.ok);
    return result;
  }

  const text = info.selectionText?.trim() ?? '';
  if (!text) {
    await setBadge('FAIL', false);
    return result;
  }

  await saveSelectedText(kind, text, {
    sourceTitle: tab?.title ?? '',
    sourceUrl: tab?.url ?? '',
    sourceDomain: domainFromUrl(tab?.url),
    surrounding: '',
    capturedAt: Date.now(),
  });
  await setBadge(kind === 'word' ? 'WORD' : 'QTE', true);
  return { ok: true };
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
  await saveSelectedText(kind, text, {
    sourceTitle: metadata.sourceTitle,
    sourceUrl: metadata.sourceUrl,
    sourceDomain: metadata.sourceDomain,
    surrounding: '',
    capturedAt: Date.now(),
  });
  await setBadge(kind === 'word' ? 'WORD' : 'QTE', true);
  return { ok: true };
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

async function saveSelectedText(
  kind: 'word' | 'quote',
  text: string,
  src: SourceInfo,
): Promise<void> {
  if (kind === 'word') await saveWord(text, src);
  else await saveQuote(text, src);
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
