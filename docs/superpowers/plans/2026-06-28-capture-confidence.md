# Capture Confidence (v0.2.1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After capturing a word or quote, show an in-page toast confirming what was captured with one-click Undo, and stop quotes from being saved twice.

**Architecture:** Capture functions (`saveWord`/`saveQuote`) return a small outcome object describing the action taken. The background injects a self-contained Shadow-DOM toast on the scripting path; its Undo button sends a runtime message that is reversed through the existing `requestSyncMutation` pipeline (so deletions are tombstoned and the debounced sync is scheduled). Quote de-duplication is a global normalized-text scan inside the capture mutator. The popup renders an inline confirmation instead of a toast and calls the same undo logic directly.

**Tech Stack:** TypeScript, WXT (MV3 extension), React (popup), Vitest + `wxt/testing/fake-browser` + happy-dom, CRDT sync layer (OR-Sets with hybrid-timestamp tombstones).

## Global Constraints

- **No new permissions.** Toast uses the already-granted `scripting` permission; Undo uses runtime messaging. The build manifest must be unchanged.
- **i18n key parity.** Every key added to `messages.en` MUST also be added to `messages['zh-CN']` — `tests/i18n-source.test.ts` asserts both tables have identical keys. UI strings must go through `t(locale, key)`, never inline `locale === 'en' ? …` in `entrypoints/`.
- **Injected renderer is serialized.** `renderCaptureToast` is passed to `browser.scripting.executeScript({ func })`; it MUST NOT reference any module-level import, constant, or closure variable. All data arrives via its single `args` object. It may use `document` and `chrome` globals (it runs in the isolated content world).
- **Word vs quote tombstone keys differ.** Quotes are tombstoned by `quote:<id>`; words by `word:<normalized>` (via `wordKey(normalized)`). Never delete a word by its id.
- **Occurrence ids are derived, not stored.** The OR-Set element id is `legacyOccurrenceId(wordId, occ)` = `occ:fnv1a(wordId|sourceUrl|surrounding|capturedAt)`. Recompute it from the full tuple; `capturedAt` alone is insufficient.
- **Undo routes through `requestSyncMutation`** (never call `applyDeletion`/`applyOccurrenceRemoval` directly from an ad-hoc handler) so `scheduleDebouncedSync()` always fires.
- **Verification gate:** `npm run compile && npm test` green, plus `npm run build` succeeds with an unchanged manifest.

---

## File Structure

- `lib/capture.ts` (modify) — outcome types (`WordAction`, `QuoteAction`, `CaptureOutcome`, `TaggedOutcome`), undo-message type + constant, quote dedupe, word action reporting.
- `lib/capture-toast.ts` (new) — pure helpers (`captureToastHeadline`, `truncateForToast`, `buildUndoMessage`) + the self-contained injected `renderCaptureToast` + `CaptureToastArgs`.
- `lib/i18n.ts` (modify) — toast message keys in both locales.
- `lib/sync/mutations.ts` (modify) — `applyOccurrenceRemoval` (mirrors `applyTagRemoval`); occurrence-tombstone carry-forward in `reconcileOnStartup`.
- `entrypoints/background/sync-mutation-handler.ts` (modify) — add `removeOccurrence` kind to the broker.
- `entrypoints/background/capture-undo.ts` (new) — `undoCapture(message)` shared by background listener and popup.
- `entrypoints/background/capture-handler.ts` (modify) — propagate outcome, inject toast, restricted-page fallback stays badge-only.
- `entrypoints/background/index.ts` (modify) — `undo-capture` message listener.
- `entrypoints/popup/Popup.tsx` (modify) — inline confirmation + Undo for the manual path.

Dependency order: Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9.

---

## Task 1: Capture outcome model + quote dedupe

**Files:**
- Modify: `lib/capture.ts`
- Test: `tests/capture.test.ts`

**Interfaces:**
- Consumes: `normalizeText` (`lib/normalize`), `mutateInboxSynced` (`lib/sync/mutations`), `WordEntry`/`QuoteEntry`/`Occurrence`/`Cloze` (`lib/types`).
- Produces:
  - `type WordAction = 'created' | 'occurrence-added' | 'duplicate'`
  - `type QuoteAction = 'created' | 'duplicate'`
  - `interface CaptureOutcome<E, A> { entry: E; action: A; occurrenceCapturedAt?: number }`
  - `type TaggedOutcome = { kind: 'word'; entry: WordEntry; action: WordAction; occurrenceCapturedAt?: number } | { kind: 'quote'; entry: QuoteEntry; action: QuoteAction }`
  - `const UNDO_CAPTURE_MESSAGE = 'undo-capture'`
  - `interface UndoCaptureMessage { type: typeof UNDO_CAPTURE_MESSAGE; kind: 'word' | 'quote'; action: WordAction | QuoteAction; entryId: string; normalized?: string; occurrence?: { sourceUrl: string; surrounding: string; capturedAt: number } }`
  - `saveWord(text, src): Promise<CaptureOutcome<WordEntry, WordAction> | null>`
  - `saveQuote(text, src): Promise<CaptureOutcome<QuoteEntry, QuoteAction> | null>`

- [ ] **Step 1: Update existing tests to the new return shape and dedupe behavior**

The current `saveQuote` tests assume "always creates a new quote" and read the return value as the entry. Replace those with the new contract. In `tests/capture.test.ts`:

Replace the `saveQuote` describe block (lines 53–83) with:

```ts
describe('saveQuote', () => {
  it('creates a new quote and reports action "created"', async () => {
    const outcome = await saveQuote('学而时习之', src);
    expect(outcome).not.toBeNull();
    expect(outcome!.action).toBe('created');
    expect(outcome!.entry.tags).toEqual([]);
    expect('category' in outcome!.entry).toBe(false);
    expect((await getInbox()).quotes).toHaveLength(1);
  });

  it('suppresses an identical quote and reports action "duplicate"', async () => {
    await saveQuote('学而时习之', src);
    const outcome = await saveQuote('学而时习之', { ...src, capturedAt: 2000 });
    expect(outcome!.action).toBe('duplicate');
    expect((await getInbox()).quotes).toHaveLength(1);
  });

  it('treats whitespace/edge-punctuation variants as duplicates', async () => {
    await saveQuote('学而时习之', src);
    const outcome = await saveQuote('  学而时习之。 ', { ...src, capturedAt: 3000 });
    expect(outcome!.action).toBe('duplicate');
    expect((await getInbox()).quotes).toHaveLength(1);
  });

  it('still creates genuinely different quotes', async () => {
    await saveQuote('学而时习之', src);
    await saveQuote('有朋自远方来', { ...src, capturedAt: 4000 });
    expect((await getInbox()).quotes).toHaveLength(2);
  });

  it('leaves the existing quote untouched on duplicate (no updatedAt bump)', async () => {
    await saveQuote('学而时习之', { ...src, capturedAt: 1000 });
    const before = (await getInbox()).quotes[0].updatedAt;
    await saveQuote('学而时习之', { ...src, capturedAt: 9999 });
    expect((await getInbox()).quotes[0].updatedAt).toBe(before);
  });

  it('ignores empty text', async () => {
    const outcome = await saveQuote('', src);
    expect(outcome).toBeNull();
    expect((await getInbox()).quotes).toHaveLength(0);
  });

  it('saves a quote parked with no clozes', async () => {
    const outcome = await saveQuote('满足人们的刚需才能持续花钱', src);
    expect(outcome).not.toBeNull();
    expect((await getInbox()).quotes[0].clozes).toEqual([]);
  });
});
```

Add a new `saveWord` action describe block after the existing `saveWord` block:

```ts
describe('saveWord actions', () => {
  it('reports "created" for a new word', async () => {
    const outcome = await saveWord('你好', src);
    expect(outcome!.action).toBe('created');
    expect(outcome!.entry.text).toBe('你好');
  });

  it('reports "occurrence-added" with occurrenceCapturedAt', async () => {
    await saveWord('你好', src);
    const outcome = await saveWord('你好', {
      ...src, sourceUrl: 'https://example.com/b', capturedAt: 2000,
    });
    expect(outcome!.action).toBe('occurrence-added');
    expect(outcome!.occurrenceCapturedAt).toBe(2000);
  });

  it('reports "duplicate" for a suppressed duplicate occurrence', async () => {
    await saveWord('你好', src);
    const outcome = await saveWord('你好', src);
    expect(outcome!.action).toBe('duplicate');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/capture.test.ts`
Expected: FAIL — `saveQuote` still creates duplicates and returns a bare entry, so `outcome!.action` is `undefined`.

- [ ] **Step 3: Add the outcome/undo types to `lib/capture.ts`**

After the `import` lines and the `SourceInfo` interface, add:

```ts
export type WordAction = 'created' | 'occurrence-added' | 'duplicate';
export type QuoteAction = 'created' | 'duplicate';

export interface CaptureOutcome<E, A> {
  /** The resulting (new or existing) entry. */
  entry: E;
  action: A;
  /** For 'occurrence-added': identifies the occurrence to remove on undo. */
  occurrenceCapturedAt?: number;
}

export type TaggedOutcome =
  | { kind: 'word'; entry: WordEntry; action: WordAction; occurrenceCapturedAt?: number }
  | { kind: 'quote'; entry: QuoteEntry; action: QuoteAction };

export const UNDO_CAPTURE_MESSAGE = 'undo-capture' as const;

export interface UndoCaptureMessage {
  type: typeof UNDO_CAPTURE_MESSAGE;
  kind: 'word' | 'quote';
  action: WordAction | QuoteAction;
  /** Word entry id or quote id. */
  entryId: string;
  /** Required for word undo — words are tombstoned by `word:<normalized>`. */
  normalized?: string;
  /** Required for 'occurrence-added' — full tuple to recompute the OR-Set element id. */
  occurrence?: { sourceUrl: string; surrounding: string; capturedAt: number };
}
```

- [ ] **Step 4: Rewrite `saveWord` to return a `CaptureOutcome`**

Replace the body of `saveWord` (keep the empty-input early return) so it sets an `outcome` instead of `result`:

```ts
export async function saveWord(
  text: string,
  src: SourceInfo,
): Promise<CaptureOutcome<WordEntry, WordAction> | null> {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return null;

  let outcome: CaptureOutcome<WordEntry, WordAction> | null = null;
  await mutateInboxSynced((inbox) => {
    const idx = inbox.words.findIndex((w) => w.normalized === normalized);
    if (idx === -1) {
      const now = src.capturedAt;
      const word: WordEntry = {
        id: makeId(),
        kind: 'word',
        text: text.trim(),
        normalized,
        note: '',
        status: 'inbox',
        createdAt: now,
        updatedAt: now,
        occurrences: [{ ...src }],
        pinyin: undefined,
      };
      outcome = { entry: word, action: 'created' };
      return { ...inbox, words: [word, ...inbox.words] };
    }

    const existing = inbox.words[idx];
    const isDuplicateOccurrence = existing.occurrences.some(
      (o) =>
        o.sourceUrl === src.sourceUrl &&
        o.surrounding === src.surrounding &&
        Math.abs(o.capturedAt - src.capturedAt) < DEDUPE_WINDOW_MS,
    );
    if (isDuplicateOccurrence) {
      outcome = { entry: existing, action: 'duplicate' };
      return inbox;
    }

    const occurrence: Occurrence = { ...src };
    const updated: WordEntry = {
      ...existing,
      occurrences: [...existing.occurrences, occurrence],
      updatedAt: src.capturedAt,
    };
    outcome = { entry: updated, action: 'occurrence-added', occurrenceCapturedAt: src.capturedAt };
    const words = [...inbox.words];
    words[idx] = updated;
    return { ...inbox, words };
  });
  return outcome;
}
```

- [ ] **Step 5: Rewrite `saveQuote` with dedupe + outcome**

Replace `saveQuote`:

```ts
export async function saveQuote(
  text: string,
  src: SourceInfo,
): Promise<CaptureOutcome<QuoteEntry, QuoteAction> | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const key = normalizeText(trimmed);

  const now = src.capturedAt;
  let outcome: CaptureOutcome<QuoteEntry, QuoteAction> | null = null;
  await mutateInboxSynced((inbox) => {
    // Scan inside the mutator (on the fresh inbox) to avoid a TOCTOU race.
    const existing = inbox.quotes.find((q) => normalizeText(q.text) === key);
    if (existing) {
      outcome = { entry: existing, action: 'duplicate' };
      return inbox; // untouched — no source merge, no updatedAt bump
    }

    const clozes: Cloze[] = [];
    const quote: QuoteEntry = {
      id: makeId(),
      kind: 'quote',
      text: trimmed,
      tags: [],
      note: '',
      status: 'inbox',
      createdAt: now,
      updatedAt: now,
      sourceTitle: src.sourceTitle,
      sourceUrl: src.sourceUrl,
      sourceDomain: src.sourceDomain,
      surrounding: src.surrounding,
      pinyin: undefined,
      clozes,
    };
    outcome = { entry: quote, action: 'created' };
    return { ...inbox, quotes: [quote, ...inbox.quotes] };
  });
  return outcome;
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/capture.test.ts`
Expected: PASS (all `saveWord` and `saveQuote` blocks green).

- [ ] **Step 7: Commit**

```bash
git add lib/capture.ts tests/capture.test.ts
git commit -m "feat(capture): return capture outcomes and dedupe quotes by normalized text"
```

---

## Task 2: Toast renderer + pure helpers + i18n keys

**Files:**
- Create: `lib/capture-toast.ts`
- Modify: `lib/i18n.ts`
- Test: `tests/capture-toast.test.ts`

**Interfaces:**
- Consumes: `t` (`lib/i18n`), `UiLocale` (`lib/types`), `WordAction`/`QuoteAction`/`TaggedOutcome`/`UndoCaptureMessage`/`UNDO_CAPTURE_MESSAGE` (`lib/capture`), `SourceInfo` (`lib/capture`).
- Produces:
  - `interface CaptureToastArgs { headline: string; text: string; undoLabel: string; undoneLabel: string; undoable: boolean; undoMessage: UndoCaptureMessage | null }`
  - `captureToastHeadline(kind, action, locale): { headline: string; undoable: boolean }`
  - `truncateForToast(text: string, max?: number): string`
  - `buildUndoMessage(outcome: TaggedOutcome, src: SourceInfo): UndoCaptureMessage | null`
  - `renderCaptureToast(args: CaptureToastArgs): void` (self-contained, injectable)

- [ ] **Step 1: Add toast message keys to both locales in `lib/i18n.ts`**

In the `en` table add (near the other top-level keys):

```ts
    'toast.savedWord': 'Saved as word',
    'toast.savedOccurrence': 'New occurrence recorded',
    'toast.savedQuote': 'Saved as quote',
    'toast.duplicate': 'Already saved',
    'toast.undo': 'Undo',
    'toast.undone': 'Undone',
```

In the `'zh-CN'` table add the matching keys:

```ts
    'toast.savedWord': '已保存为词',
    'toast.savedOccurrence': '已记录新出处',
    'toast.savedQuote': '已保存为句',
    'toast.duplicate': '已存在',
    'toast.undo': '撤销',
    'toast.undone': '已撤销',
```

- [ ] **Step 2: Write the failing test**

Create `tests/capture-toast.test.ts`:

```ts
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
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/capture-toast.test.ts`
Expected: FAIL with "Cannot find module '../lib/capture-toast'".

- [ ] **Step 4: Create `lib/capture-toast.ts`**

```ts
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
    '.card{font-family:system-ui,-apple-system,sans-serif;background:#faf6ef;color:#2b2b2b;',
    'border:1px solid #e5ddcf;border-left:4px solid #16a34a;border-radius:6px;',
    'box-shadow:0 6px 24px rgba(0,0,0,.18);padding:12px 14px;max-width:320px;',
    'display:flex;flex-direction:column;gap:6px;animation:shiyuIn .18s ease-out}',
    '.headline{font-size:12px;letter-spacing:.5px;color:#9c4221;font-weight:600}',
    '.text{font-size:14px;line-height:1.4;word-break:break-word}',
    '.actions{display:flex;justify-content:flex-end;margin-top:2px}',
    'button{font:inherit;font-size:12px;cursor:pointer;border:1px solid #d6ccb8;',
    'background:transparent;color:#9c4221;border-radius:4px;padding:4px 10px}',
    'button:hover{background:#f0e9dd}',
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
      chrome.runtime.sendMessage(args.undoMessage, () => {
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
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/capture-toast.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the i18n parity test**

Run: `npx vitest run tests/i18n-source.test.ts`
Expected: PASS (en and zh-CN at full key parity).

- [ ] **Step 7: Commit**

```bash
git add lib/capture-toast.ts lib/i18n.ts tests/capture-toast.test.ts
git commit -m "feat(capture): add injectable capture toast renderer and helpers"
```

---

## Task 3: Occurrence-removal mutation + tombstone carry-forward

**Files:**
- Modify: `lib/sync/mutations.ts`
- Test: `tests/sync/occurrence-removal.test.ts` (new)

**Interfaces:**
- Consumes: `wordKey` (`lib/sync/project`), `mergeStampMap` (`lib/sync/registers`, already imported), `ensureReplicaId`, `syncMetadataStorage`, `mutateSyncConfig`, `EMPTY_SYNC_STATE`.
- Produces: `applyOccurrenceRemoval(removals: Array<{ normalized: string; occurrenceId: string }>): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/sync/occurrence-removal.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applyOccurrenceRemoval, syncMetadataStorage } from '../../lib/sync/mutations';
import { EMPTY_SYNC_STATE } from '../../lib/sync/types';

describe('applyOccurrenceRemoval', () => {
  beforeEach(() => fakeBrowser.reset());

  it('writes an occurrence tombstone on an existing word node and bumps revision once', async () => {
    await syncMetadataStorage.setValue({
      revision: 5, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0,
      state: {
        ...EMPTY_SYNC_STATE,
        words: {
          'word:你好': {
            normalized: '你好', fields: {},
            createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } },
            occurrences: { 'occ:abc': { id: 'occ:abc', sourceTitle: '', sourceUrl: 'u', sourceDomain: '', surrounding: 's', capturedAt: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } } },
            occurrenceTombstones: {}, reviewEvents: {},
          },
        },
      },
    });

    await applyOccurrenceRemoval([{ normalized: '你好', occurrenceId: 'occ:abc' }]);

    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(6);
    expect(meta.state!.words['word:你好'].occurrenceTombstones['occ:abc']).toBeDefined();
  });

  it('creates a minimal word node when the node is missing', async () => {
    await syncMetadataStorage.setValue({
      revision: 0, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0,
      state: { ...EMPTY_SYNC_STATE },
    });
    await applyOccurrenceRemoval([{ normalized: '新词', occurrenceId: 'occ:xyz' }]);
    const meta = await syncMetadataStorage.getValue();
    expect(meta.state!.words['word:新词'].occurrenceTombstones['occ:xyz']).toBeDefined();
    expect(meta.state!.words['word:新词'].normalized).toBe('新词');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sync/occurrence-removal.test.ts`
Expected: FAIL with "applyOccurrenceRemoval is not a function" (not exported).

- [ ] **Step 3: Add `applyOccurrenceRemoval` to `lib/sync/mutations.ts`**

Add `import { wordKey } from './project';` to the existing imports. Then add this function (mirrors `applyTagRemoval`), after `applyTagRemoval`:

> Note on the minimal-node branch: like `applyTagRemoval`, when the word node is
> missing we create a stub with `fields: {}`. This branch is **defensive only** —
> the real undo path always operates on a word that exists (an occurrence was just
> added to it). Such a stub would not be suppressed by `materialize`
> (`isSuppressed(undefined, …)` is `false`), but it carries no `text`/`status`, so
> do **not** assert it materializes to a clean word. In practice it never reaches
> `materialize`: the next `reconcileOnStartup` rebuilds `state.words` from the inbox
> (where `新词` is absent), dropping the stub and its tombstone. The "creates a
> minimal word node" test therefore asserts only the tombstone write, matching the
> established tag-removal behavior.

```ts
export async function applyOccurrenceRemoval(
  removals: Array<{ normalized: string; occurrenceId: string }>,
): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    const state: SyncState = meta.state ?? (JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState);
    const now = Date.now();
    for (const { normalized, occurrenceId } of removals) {
      const key = wordKey(normalized);
      let node = state.words[key];
      if (!node) {
        node = {
          normalized,
          fields: {},
          createdAt: { value: now, stamp: { wallTime: now, counter: 0, replicaId } },
          occurrences: {},
          occurrenceTombstones: {},
          reviewEvents: {},
        };
        state.words[key] = node;
      }
      if (!node.occurrenceTombstones) node.occurrenceTombstones = {};
      node.occurrenceTombstones[occurrenceId] = { wallTime: now, counter: 0, replicaId };
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}
```

- [ ] **Step 4: Add occurrence-tombstone carry-forward to `reconcileOnStartup`**

`projectWord` resets `occurrenceTombstones: {}` (`lib/sync/project.ts`), so — exactly like the existing `tagTombstones` carry-forward — `reconcileOnStartup` must re-merge them or an undo written just before an interrupted edit is lost on rebuild. In `reconcileOnStartup`, after the existing `if (meta.state?.quotes) { … tagTombstones … }` block, add:

```ts
  // Per-word occurrence removals live only in each word node's
  // `occurrenceTombstones` map (projection resets it to {}), so they need the
  // same carry-forward as tagTombstones — otherwise a `removeOccurrence`
  // written just before an interrupted inbox edit is lost on rebuild and a
  // remote replica still holding the occurrence resurrects it.
  if (meta.state?.words) {
    for (const [id, node] of Object.entries(state.words)) {
      const prevTombstones = meta.state.words[id]?.occurrenceTombstones;
      if (prevTombstones) {
        node.occurrenceTombstones = mergeStampMap(prevTombstones, node.occurrenceTombstones ?? {});
      }
    }
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/sync/occurrence-removal.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the existing sync tests to confirm no regression**

Run: `npx vitest run tests/sync`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/sync/mutations.ts tests/sync/occurrence-removal.test.ts
git commit -m "feat(sync): add occurrence OR-Set removal and tombstone carry-forward"
```

---

## Task 4: Wire `removeOccurrence` into the sync mutation broker

**Files:**
- Modify: `entrypoints/background/sync-mutation-handler.ts`
- Test: `tests/sync/sync-mutation-handler.test.ts`

**Interfaces:**
- Consumes: `applyOccurrenceRemoval` (Task 3).
- Produces: `requestSyncMutation('removeOccurrence', { removals: Array<{ normalized: string; occurrenceId: string }> })`; `SyncMutationRequestMessage['kind']` gains `'removeOccurrence'`.

- [ ] **Step 1: Write the failing test**

Append to `tests/sync/sync-mutation-handler.test.ts` (inside a new describe at the end of the file):

```ts
describe('removeOccurrence kind', () => {
  beforeEach(() => fakeBrowser.reset());

  it('routes to applyOccurrenceRemoval and bumps the revision', async () => {
    registerSyncMutationHandler();
    await requestSyncMutation('removeOccurrence', {
      removals: [{ normalized: '你好', occurrenceId: 'occ:abc' }],
    });
    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBeGreaterThan(0);
    expect(meta.state!.words['word:你好'].occurrenceTombstones['occ:abc']).toBeDefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sync/sync-mutation-handler.test.ts -t "removeOccurrence"`
Expected: FAIL — `'removeOccurrence'` is not an accepted kind, so the broker falls through to `applyLocalMutation` and never writes the tombstone (and TypeScript will reject the literal).

- [ ] **Step 3: Add the kind to the broker**

In `entrypoints/background/sync-mutation-handler.ts`:

Update the import on line 1:

```ts
import { applyDeletion, applyLocalMutation, applyTagRemoval, applyOccurrenceRemoval } from '../../lib/sync/mutations';
```

Extend the `kind` union:

```ts
  kind: 'inbox' | 'settings' | 'ai' | 'delete' | 'removeTags' | 'removeOccurrence';
```

Add a branch in `writeKind`, after the `removeTags` branch:

```ts
  } else if (kind === 'removeOccurrence') {
    const { removals } = payload as { removals: Array<{ normalized: string; occurrenceId: string }> };
    await applyOccurrenceRemoval(removals);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/sync/sync-mutation-handler.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/background/sync-mutation-handler.ts tests/sync/sync-mutation-handler.test.ts
git commit -m "feat(sync): route removeOccurrence through the mutation broker"
```

---

## Task 5: Shared `undoCapture` reversal logic

**Files:**
- Create: `entrypoints/background/capture-undo.ts`
- Test: `tests/capture-undo.test.ts` (new)

**Interfaces:**
- Consumes: `requestSyncMutation` (`./sync-mutation-handler`), `getInbox` (`lib/storage`), `wordKey` + `legacyOccurrenceId` (`lib/sync/project`), `UndoCaptureMessage` (`lib/capture`), `Occurrence` (`lib/types`).
- Produces: `undoCapture(message: UndoCaptureMessage): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `tests/capture-undo.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { undoCapture } from '../entrypoints/background/capture-undo';
import { registerSyncMutationHandler } from '../entrypoints/background/sync-mutation-handler';
import { saveWord, saveQuote } from '../lib/capture';
import { legacyOccurrenceId } from '../lib/sync/project';
import { getInbox } from '../lib/storage';
import { syncMetadataStorage } from '../lib/sync/mutations';

const SRC = {
  sourceTitle: 'Page', sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com', surrounding: 'ctx', capturedAt: 1000,
};

beforeEach(() => {
  fakeBrowser.reset();
  registerSyncMutationHandler();
});

describe('undoCapture', () => {
  it('created quote → removes from inbox and tombstones quote:<id>', async () => {
    const outcome = await saveQuote('学而时习之', SRC);
    const id = outcome!.entry.id;
    await undoCapture({ type: 'undo-capture', kind: 'quote', action: 'created', entryId: id });
    expect((await getInbox()).quotes).toHaveLength(0);
    expect((await syncMetadataStorage.getValue()).state!.tombstones[`quote:${id}`]).toBeDefined();
  });

  it('created word → removes from inbox and tombstones word:<normalized>', async () => {
    const outcome = await saveWord('你好', SRC);
    await undoCapture({
      type: 'undo-capture', kind: 'word', action: 'created',
      entryId: outcome!.entry.id, normalized: '你好',
    });
    expect((await getInbox()).words).toHaveLength(0);
    expect((await syncMetadataStorage.getValue()).state!.tombstones['word:你好']).toBeDefined();
  });

  it('occurrence-added → removes the occurrence and writes its tombstone', async () => {
    await saveWord('你好', SRC);
    const outcome = await saveWord('你好', { ...SRC, sourceUrl: 'https://example.com/b', capturedAt: 2000 });
    const wordId = outcome!.entry.id;
    const occ = { sourceUrl: 'https://example.com/b', surrounding: 'ctx', capturedAt: 2000 };
    await undoCapture({
      type: 'undo-capture', kind: 'word', action: 'occurrence-added',
      entryId: wordId, normalized: '你好', occurrence: occ,
    });
    const inbox = await getInbox();
    expect(inbox.words[0].occurrences).toHaveLength(1);
    const occId = legacyOccurrenceId(wordId, { sourceTitle: '', sourceDomain: '', ...occ });
    expect((await syncMetadataStorage.getValue()).state!.words['word:你好'].occurrenceTombstones[occId]).toBeDefined();
  });

  it('is a no-op when the entry is already gone', async () => {
    await undoCapture({ type: 'undo-capture', kind: 'quote', action: 'created', entryId: 'missing' });
    expect((await getInbox()).quotes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/capture-undo.test.ts`
Expected: FAIL with "Cannot find module '../entrypoints/background/capture-undo'".

- [ ] **Step 3: Create `entrypoints/background/capture-undo.ts`**

```ts
import { requestSyncMutation } from './sync-mutation-handler';
import { getInbox } from '../../lib/storage';
import { wordKey, legacyOccurrenceId } from '../../lib/sync/project';
import type { UndoCaptureMessage } from '../../lib/capture';
import type { Occurrence } from '../../lib/types';

/**
 * Reverse a capture via the standard mutation pipeline. Best-effort and
 * idempotent: a missing entry/occurrence simply yields a no-op inbox write.
 * Routed through requestSyncMutation so debounced sync is always scheduled.
 */
export async function undoCapture(message: UndoCaptureMessage): Promise<void> {
  const inbox = await getInbox();

  if (message.kind === 'quote') {
    await requestSyncMutation('delete', [`quote:${message.entryId}`]);
    await requestSyncMutation('inbox', {
      ...inbox,
      quotes: inbox.quotes.filter((q) => q.id !== message.entryId),
    });
    return;
  }

  if (message.action === 'created') {
    if (message.normalized) {
      await requestSyncMutation('delete', [wordKey(message.normalized)]);
    }
    await requestSyncMutation('inbox', {
      ...inbox,
      words: inbox.words.filter((w) => w.id !== message.entryId),
    });
    return;
  }

  // occurrence-added
  const occ = message.occurrence;
  if (!occ) return;
  if (message.normalized) {
    const occurrenceId = legacyOccurrenceId(message.entryId, {
      sourceTitle: '', sourceDomain: '', ...occ,
    } as Occurrence);
    await requestSyncMutation('removeOccurrence', {
      removals: [{ normalized: message.normalized, occurrenceId }],
    });
  }
  await requestSyncMutation('inbox', {
    ...inbox,
    words: inbox.words.map((w) =>
      w.id === message.entryId
        ? {
            ...w,
            occurrences: w.occurrences.filter(
              (o) =>
                !(
                  o.sourceUrl === occ.sourceUrl &&
                  o.surrounding === occ.surrounding &&
                  o.capturedAt === occ.capturedAt
                ),
            ),
          }
        : w,
    ),
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/capture-undo.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/background/capture-undo.ts tests/capture-undo.test.ts
git commit -m "feat(capture): add shared undoCapture reversal routed through the broker"
```

---

## Task 6: Propagate outcomes and inject the toast in capture-handler

**Files:**
- Modify: `entrypoints/background/capture-handler.ts`
- Test: `tests/capture-handler.test.ts`

**Interfaces:**
- Consumes: `saveWord`/`saveQuote`/`TaggedOutcome`/`SourceInfo` (`lib/capture`), `getSettings` (`lib/settings`), `t` (`lib/i18n`), `captureToastHeadline`/`truncateForToast`/`buildUndoMessage`/`renderCaptureToast`/`CaptureToastArgs` (`lib/capture-toast`).
- Produces:
  - `CaptureResult = { ok: true; outcome: TaggedOutcome | null; undo: UndoCaptureMessage | null } | { ok: false; reason: 'no-active-tab' | 'restricted-page' | 'no-selection' }`
  - `handleCapture`, `handleContextMenuCapture`, `handleManualCapture` unchanged signatures (return the extended `CaptureResult`).

- [ ] **Step 1: Update existing capture-handler tests to the new result shape**

The current happy-path assertions use `expect(result).toEqual({ ok: true })`, which now fails because `ok: true` carries `outcome` and `undo`. In `tests/capture-handler.test.ts`, replace each `expect(result).toEqual({ ok: true })` with:

```ts
    expect(result.ok).toBe(true);
```

(Leave `ok: false` assertions, e.g. `{ ok: false, reason: 'no-selection' }`, unchanged.)

- [ ] **Step 2: Add toast-injection tests**

Append a new describe block to `tests/capture-handler.test.ts`:

```ts
describe('toast injection', () => {
  it('injects renderCaptureToast on a successful keyboard capture', async () => {
    await handleCapture('word');
    const calls = (fakeBrowser.scripting.executeScript as any).mock.calls;
    const toastCall = calls.find((c: any[]) => c[0].func === renderCaptureToast);
    expect(toastCall).toBeTruthy();
    expect(toastCall[0].target).toEqual({ tabId: 1 });
    expect(Array.isArray(toastCall[0].args)).toBe(true);
  });

  it('still sets the badge and does not throw when toast injection fails', async () => {
    // First executeScript (readPageContext) succeeds; the toast injection rejects.
    (fakeBrowser.scripting.executeScript as any)
      .mockResolvedValueOnce([{ result: GOOD_CTX } as any])
      .mockRejectedValueOnce(new Error('restricted'));
    const result = await handleCapture('word');
    expect(result.ok).toBe(true);
    expect((await getInbox()).words).toHaveLength(1);
  });
});
```

Add `renderCaptureToast` to the imports at the top of the test file:

```ts
import { renderCaptureToast } from '../lib/capture-toast';
```

> These tests reuse the file's existing fixtures: `GOOD_CTX` (the page-context
> object defined at the top of `tests/capture-handler.test.ts`) and the default
> `beforeEach`, which spies `fakeBrowser.scripting.executeScript` to resolve
> `[{ result: GOOD_CTX }]`. That default makes the first `executeScript`
> (`readPageContext`) succeed so the capture reaches `maybeShowToast`; the toast
> injection is the *second* `executeScript` call, located by `func === renderCaptureToast`.
> Do not add a new `beforeEach` — rely on the existing one.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/capture-handler.test.ts`
Expected: FAIL — no toast injection happens yet, so the `toastCall` lookup is undefined.

- [ ] **Step 4: Rewrite `entrypoints/background/capture-handler.ts`**

Replace the imports and the capture core. New top imports:

```ts
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
```

Replace the `CaptureResult` type:

```ts
export type CaptureResult =
  | { ok: true; outcome: TaggedOutcome | null; undo: UndoCaptureMessage | null }
  | { ok: false; reason: 'no-active-tab' | 'restricted-page' | 'no-selection' };
```

Replace `saveSelectedText` with a `capture` helper that produces a tagged outcome, and add an `okResult` helper:

```ts
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
```

Rewrite `captureActiveTab` to return the result plus the tab/src needed for the toast:

```ts
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
```

Add the toast injector:

```ts
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
```

Rewrite `handleCapture`:

```ts
export async function handleCapture(kind: 'word' | 'quote'): Promise<CaptureResult> {
  const { result, tabId } = await captureActiveTab(kind);
  await setBadge(result.ok ? (kind === 'word' ? 'WORD' : 'QTE') : 'FAIL', result.ok);
  if (result.ok && tabId != null) {
    await maybeShowToast(tabId, result.outcome, result.undo);
  }
  return result;
}
```

Rewrite `handleContextMenuCapture` (happy path injects toast; restricted fallback is badge-only):

```ts
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
```

Rewrite `handleManualCapture` to return the outcome (no toast — popup renders inline):

```ts
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
```

Leave `pageMetadataForTab`, `domainFromUrl`, `setBadge`, and the `ActiveTab` re-export as they are.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/capture-handler.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/background/capture-handler.ts tests/capture-handler.test.ts
git commit -m "feat(capture): surface outcomes and inject confirmation toast on capture"
```

---

## Task 7: Register the `undo-capture` background listener

**Files:**
- Modify: `entrypoints/background/index.ts`
- Test: `tests/undo-capture-listener.test.ts` (new)

**Interfaces:**
- Consumes: `undoCapture` (`./capture-undo`), `UNDO_CAPTURE_MESSAGE`/`UndoCaptureMessage` (`lib/capture`).
- Produces: a `browser.runtime.onMessage` listener that resolves `{ ok: true }` for `undo-capture` messages.

- [ ] **Step 1: Write the failing test**

Create `tests/undo-capture-listener.test.ts`. The listener registration lives inside `defineBackground`'s callback; the test seeds an entry, dispatches the message through `fakeBrowser`, and asserts the reversal happened.

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveQuote } from '../lib/capture';
import { getInbox } from '../lib/storage';
import { registerUndoCaptureListener } from '../entrypoints/background/index';

beforeEach(() => fakeBrowser.reset());

describe('undo-capture listener', () => {
  it('reverses a created quote and acks { ok: true }', async () => {
    registerUndoCaptureListener();
    const outcome = await saveQuote('学而时习之', {
      sourceTitle: 'P', sourceUrl: 'u', sourceDomain: 'd', surrounding: '', capturedAt: 1,
    });
    const ack = await fakeBrowser.runtime.sendMessage({
      type: 'undo-capture', kind: 'quote', action: 'created', entryId: outcome!.entry.id,
    });
    expect(ack).toEqual({ ok: true });
    expect((await getInbox()).quotes).toHaveLength(0);
  });

  it('ignores unrelated messages', async () => {
    registerUndoCaptureListener();
    const ack = await fakeBrowser.runtime.sendMessage({ type: 'something-else' });
    expect(ack).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/undo-capture-listener.test.ts`
Expected: FAIL with "registerUndoCaptureListener is not a function" (not exported).

- [ ] **Step 3: Add and register the listener in `entrypoints/background/index.ts`**

Add imports near the top:

```ts
import { undoCapture } from './capture-undo';
import { UNDO_CAPTURE_MESSAGE, type UndoCaptureMessage } from '../../lib/capture';
```

Add an exported registration helper (so it is unit-testable in isolation), above `export default defineBackground(...)`:

```ts
export function registerUndoCaptureListener(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      message != null &&
      typeof message === 'object' &&
      'type' in message &&
      (message as { type: unknown }).type === UNDO_CAPTURE_MESSAGE
    ) {
      return undoCapture(message as UndoCaptureMessage).then(() => ({ ok: true }));
    }
    return undefined;
  });
}
```

Call it inside the `defineBackground` callback, alongside the other listener registrations (e.g. right after `registerSyncMutationHandler();`):

```ts
  registerUndoCaptureListener();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/undo-capture-listener.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/background/index.ts tests/undo-capture-listener.test.ts
git commit -m "feat(capture): handle undo-capture messages in the background"
```

---

## Task 8: Popup inline confirmation + Undo

**Files:**
- Modify: `entrypoints/popup/Popup.tsx`
- Test: `tests/popup-confirm.test.tsx` (new)

**Interfaces:**
- Consumes: `handleCapture`/`handleManualCapture`/`CaptureResult` (`@/entrypoints/background/capture-handler`), `undoCapture` (`@/entrypoints/background/capture-undo`), `captureToastHeadline`/`truncateForToast` (`@/lib/capture-toast`), `t` (`@/lib/i18n`).
- Produces: popup renders an inline confirmation with captured text + headline and an Undo button (when `result.undo` is present); Undo calls `undoCapture`.

- [ ] **Step 1: Write the failing test**

Create `tests/popup-confirm.test.tsx`:

```tsx
// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages } from '../lib/i18n';

const undoCapture = vi.fn().mockResolvedValue(undefined);
const handleManualCapture = vi.fn();
const handleCapture = vi.fn();

vi.mock('@/entrypoints/background/capture-undo', () => ({ undoCapture }));
vi.mock('@/entrypoints/background/capture-handler', () => ({
  handleManualCapture,
  handleCapture,
}));
vi.mock('@/lib/settings', () => ({
  getSettings: () => Promise.resolve({ uiLocale: 'en' }),
  watchSettings: () => () => {},
}));

import { Popup } from '../entrypoints/popup/Popup';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  vi.clearAllMocks();
});

/** Find a rendered <button> whose text contains `label`. */
function findButton(label: string): HTMLButtonElement {
  const btn = [...container.querySelectorAll('button')].find(
    (b) => (b.textContent ?? '').includes(label),
  );
  if (!btn) throw new Error(`button not found: ${label}`);
  return btn as HTMLButtonElement;
}

describe('popup capture confirmation', () => {
  it('shows the headline + captured text + Undo, and calls undoCapture on click', async () => {
    const undo = {
      type: 'undo-capture', kind: 'word', action: 'created',
      entryId: 'w1', normalized: '你好',
    };
    // The top "Save as word" button calls go() -> handleCapture().
    handleCapture.mockResolvedValue({
      ok: true,
      outcome: { kind: 'word', action: 'created', entry: { id: 'w1', text: '你好' } },
      undo,
    });

    await act(async () => { root.render(<Popup />); });
    await act(async () => {}); // flush the settings effect -> locale 'en'

    await act(async () => { findButton(messages.en['popup.saveWord']).click(); });

    // Confirmation surface: headline + captured text + Undo button.
    expect(container.textContent).toContain(messages.en['toast.savedWord']);
    expect(container.textContent).toContain('你好');
    const undoBtn = findButton(messages.en['toast.undo']);

    // Undo routes to the shared undoCapture with the exact undo message.
    await act(async () => { undoBtn.click(); });
    expect(undoCapture).toHaveBeenCalledWith(undo);
  });

  it('renders no Undo affordance for a duplicate (undo === null)', async () => {
    handleCapture.mockResolvedValue({
      ok: true,
      outcome: { kind: 'quote', action: 'duplicate', entry: { id: 'q1', text: '学而时习之' } },
      undo: null,
    });

    await act(async () => { root.render(<Popup />); });
    await act(async () => {});
    await act(async () => { findButton(messages.en['popup.saveWord']).click(); });

    expect(container.textContent).toContain(messages.en['toast.duplicate']);
    const undoBtn = [...container.querySelectorAll('button')].find(
      (b) => (b.textContent ?? '').includes(messages.en['toast.undo']),
    );
    expect(undoBtn).toBeUndefined();
  });
});
```

> The popup surfaces the confirmation through the shared `applyResult` path, so either
> capture entry point exercises it; this test drives the top "Save as word" button
> (`go()` → `handleCapture()`) because it needs no prior `manualKind` state. The
> `IS_REACT_ACT_ENVIRONMENT` flag and the `act`/DOM-query pattern mirror
> `tests/quote-list.test.tsx`. `onUndo` calls `window.close()` after `undoCapture`;
> happy-dom's `window.close()` is a harmless no-op, so no stub is needed.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/popup-confirm.test.tsx`
Expected: FAIL — `applyResult` currently sets `popup.saved` and calls `window.close()` on success, so no confirmation headline, captured text, or Undo button is rendered. Both assertions (`toContain(messages.en['toast.savedWord'])` and the `undoCapture` call) fail before the feature exists.

- [ ] **Step 3: Add confirmation state + UI to `Popup.tsx`**

Add imports:

```ts
import { undoCapture } from '@/entrypoints/background/capture-undo';
import { captureToastHeadline, truncateForToast } from '@/lib/capture-toast';
import type { TaggedOutcome, UndoCaptureMessage } from '@/lib/capture';
```

Add state inside `Popup`:

```ts
  const [confirm, setConfirm] = useState<
    { outcome: TaggedOutcome; undo: UndoCaptureMessage | null } | null
  >(null);
```

Replace `applyResult` so a successful capture shows the inline confirmation instead of closing immediately:

```ts
  function applyResult(kind: 'word' | 'quote', result: CaptureResult) {
    if (result.ok) {
      setManualKind(null);
      setMsg('');
      if (result.outcome) {
        setConfirm({ outcome: result.outcome, undo: result.undo });
        return;
      }
      setMsg(t(locale, 'popup.saved'));
      setTimeout(() => window.close(), 700);
      return;
    }
    setManualKind(kind);
    setMsg(failureMessage(result.reason, locale));
  }

  async function onUndo() {
    if (confirm?.undo) await undoCapture(confirm.undo);
    setConfirm(null);
    window.close();
  }
```

Render the confirmation panel (place it just before the closing `</div>` of the root, after the `{msg && …}` line):

```tsx
      {confirm && (
        <div className="space-y-2 rounded-sm border border-border bg-paper-light p-2">
          <p className="text-[11px] tracking-[1px] text-cinnabar">
            {captureToastHeadline(confirm.outcome.kind, confirm.outcome.action, locale).headline}
          </p>
          <p className="text-sm leading-5 text-ink">{truncateForToast(confirm.outcome.entry.text)}</p>
          {confirm.undo && (
            <button
              onClick={onUndo}
              className="w-full rounded-sm border border-border bg-transparent px-3 py-2 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input"
            >
              {t(locale, 'toast.undo')}
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/popup-confirm.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/popup/Popup.tsx tests/popup-confirm.test.tsx
git commit -m "feat(popup): inline capture confirmation with Undo for the manual path"
```

---

## Task 9: Full verification + build + manifest check

**Files:** none (verification only).

- [ ] **Step 1: Type-check and run the full test suite**

Run: `npm run compile && npm test`
Expected: PASS — no type errors, all suites green (including `tests/i18n-source.test.ts` parity and the pre-existing sync suite).

- [ ] **Step 2: Confirm the permission source of truth is untouched** (baseline for the no-new-permissions check)

Manifest permissions are declared in `wxt.config.ts` (`permissions`, `optional_host_permissions`), not hand-edited in a built file — so the real gate is that this branch did not change them.

Run: `git diff master -- wxt.config.ts`
Expected: empty diff (no permission lines added/removed). Also record the current declared arrays for the Step 3 comparison:

Run: `sed -n '/permissions:/,/]/p' wxt.config.ts`

- [ ] **Step 3: Build and confirm the manifest is unchanged**

Run: `npm run build`
Expected: build succeeds. Inspect `.output/chrome-mv3/manifest.json` and confirm `permissions` and `host_permissions` are unchanged from the previous release (no new entries — the toast reuses `scripting`, undo uses runtime messaging).

- [ ] **Step 4: Manual smoke test (load the unpacked build)**

Load `.output/chrome-mv3` as an unpacked extension and verify:
1. Select text on a normal page → context menu / keyboard "Save as word" → a bottom-right toast appears with the headline + text + Undo; it auto-dismisses after ~6s.
2. Click Undo within the window → toast switches to "Undone"/"已撤销" and the entry disappears from the dashboard.
3. Capture the same quote twice → second capture shows "Already saved"/"已存在" with no Undo, and the dashboard shows a single quote.
4. On a `chrome://` page, capture via context menu → only the toolbar badge appears, no error.
5. Popup paste-fallback capture → inline confirmation with Undo renders in the popup.

- [ ] **Step 5: Final commit (if any manifest/lockfile artifacts changed) and integrate**

```bash
git status
```

If clean, the feature is complete. Per the user's branch-integration preference, merge to `master` locally and do not auto-push.

---

## Self-Review Notes

- **Spec A (outcome model):** Task 1. **Spec B (quote dedupe):** Task 1 (scan inside mutator). **Spec C (toast):** Task 2 (renderer/helpers) + Task 6 (injection). **Spec D (undo):** Tasks 3–5, 7 (routed through `requestSyncMutation`; word/quote key asymmetry; derived occurrence id). **Spec E (popup):** Task 8. **Spec F (restricted pages):** Task 6 (`maybeShowToast` try/catch + context-menu fallback stays badge-only).
- **Beyond-spec correctness fix:** Task 3 Step 4 adds occurrence-tombstone carry-forward in `reconcileOnStartup`, which the spec's "mirror removeTags" omitted — `projectWord` resets `occurrenceTombstones: {}`, so without it an undo written before an interrupted edit would be lost on rebuild.
- **Type consistency:** `removeOccurrence` payload shape `{ removals: Array<{ normalized; occurrenceId }> }` is identical in Tasks 3, 4, and 5. `CaptureResult` (Task 6) carries `outcome` + `undo`, consumed unchanged by Task 8. `UndoCaptureMessage` is defined once (Task 1) and imported everywhere.
