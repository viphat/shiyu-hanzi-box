// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  captureToastHeadline,
  truncateForToast,
  buildUndoMessage,
  renderCaptureToast,
  type CaptureToastArgs,
} from '../lib/capture-toast';
import { messages } from '../lib/i18n';
import type { TaggedOutcome } from '../lib/capture';
import type { WordEntry } from '../lib/types';

const SRC = {
  sourceTitle: 'Page', sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com', surrounding: 'ctx', capturedAt: 1000,
};

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1', kind: 'word', text: '你好', normalized: '你好', note: '',
    status: 'inbox', createdAt: 1, updatedAt: 1, occurrences: [], ...overrides,
  };
}

describe('captureToastHeadline', () => {
  it('word created → savedWord, undoable', () => {
    expect(captureToastHeadline('word', 'created', 'zh-CN')).toEqual({
      headline: messages['zh-CN']['toast.savedWord'], undoable: true,
    });
  });
  it('word occurrence-added → savedOccurrence, undoable', () => {
    expect(captureToastHeadline('word', 'occurrence-added', 'en').undoable).toBe(true);
  });
  it('quote created → savedQuote, undoable', () => {
    expect(captureToastHeadline('quote', 'created', 'en').headline).toBe(messages.en['toast.savedQuote']);
  });
  it('duplicate → duplicate headline, not undoable', () => {
    expect(captureToastHeadline('quote', 'duplicate', 'en')).toEqual({
      headline: messages.en['toast.duplicate'], undoable: false,
    });
  });
});

describe('truncateForToast', () => {
  it('keeps short text', () => expect(truncateForToast('短句')).toBe('短句'));
  it('truncates long text with an ellipsis', () => {
    const long = '一'.repeat(50);
    const out = truncateForToast(long, 40);
    expect(out.length).toBe(41);
    expect(out.endsWith('…')).toBe(true);
  });
});

describe('buildUndoMessage', () => {
  it('word created carries normalized', () => {
    const o: TaggedOutcome = { kind: 'word', entry: word(), action: 'created' };
    expect(buildUndoMessage(o, SRC)).toEqual({
      type: 'undo-capture', kind: 'word', action: 'created', entryId: 'w1', normalized: '你好',
    });
  });
  it('word occurrence-added carries the occurrence tuple', () => {
    const o: TaggedOutcome = { kind: 'word', entry: word(), action: 'occurrence-added', occurrenceCapturedAt: 1000 };
    expect(buildUndoMessage(o, SRC)).toEqual({
      type: 'undo-capture', kind: 'word', action: 'occurrence-added', entryId: 'w1', normalized: '你好',
      occurrence: { sourceUrl: 'https://example.com/a', surrounding: 'ctx', capturedAt: 1000 },
    });
  });
  it('duplicate yields null (no undo)', () => {
    const o: TaggedOutcome = { kind: 'word', entry: word(), action: 'duplicate' };
    expect(buildUndoMessage(o, SRC)).toBeNull();
  });
});

describe('renderCaptureToast', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  const baseArgs: CaptureToastArgs = {
    headline: 'H', text: 'T', undoLabel: 'Undo', undoneLabel: 'Undone',
    undoable: true, undoMessage: { type: 'undo-capture', kind: 'quote', action: 'created', entryId: 'q1' },
  };

  it('mounts a single Shadow-DOM host with an Undo button when undoable', () => {
    renderCaptureToast(baseArgs);
    const host = document.getElementById('shiyu-capture-toast');
    expect(host).not.toBeNull();
    expect(host!.shadowRoot).not.toBeNull();
    expect(host!.shadowRoot!.querySelector('[data-undo]')).not.toBeNull();
  });

  it('replaces an existing toast (single instance)', () => {
    renderCaptureToast(baseArgs);
    renderCaptureToast(baseArgs);
    expect(document.querySelectorAll('#shiyu-capture-toast').length).toBe(1);
  });

  it('omits the Undo button when not undoable', () => {
    renderCaptureToast({ ...baseArgs, undoable: false, undoMessage: null });
    const host = document.getElementById('shiyu-capture-toast');
    expect(host!.shadowRoot!.querySelector('[data-undo]')).toBeNull();
  });

  it('on Undo click: sends the message via chrome.runtime, swaps to the undone label, removes the button', () => {
    // The injected renderer uses the `chrome` global (not the wxt `browser`
    // polyfill, which would be a closure ref). Stub it with the callback form.
    const sent: unknown[] = [];
    (globalThis as unknown as { chrome: unknown }).chrome = {
      runtime: { sendMessage: (msg: unknown, cb?: () => void) => { sent.push(msg); cb?.(); } },
    };

    renderCaptureToast(baseArgs);
    const host = document.getElementById('shiyu-capture-toast')!;
    const undo = host.shadowRoot!.querySelector<HTMLButtonElement>('[data-undo]')!;
    undo.click();

    expect(sent).toEqual([baseArgs.undoMessage]);
    expect(host.shadowRoot!.querySelector('[data-undo]')).toBeNull();
    expect(host.shadowRoot!.textContent).toContain(baseArgs.undoneLabel);
  });
});
