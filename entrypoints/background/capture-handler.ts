import type { Browser } from 'wxt/browser';
import { saveWord, saveQuote, type SourceInfo } from '@/lib/capture';
import { readPageContext } from '@/lib/page-context';

export const MENU_SAVE_WORD = 'save-word-menu';
export const MENU_SAVE_QUOTE = 'save-quote-menu';

async function captureActiveTab(kind: 'word' | 'quote'): Promise<{ ok: true } | { ok: false; reason: string }> {
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

export async function handleCapture(kind: 'word' | 'quote'): Promise<void> {
  const result = await captureActiveTab(kind);
  await setBadge(result.ok ? (kind === 'word' ? 'WORD' : 'QTE') : 'FAIL', result.ok);
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
