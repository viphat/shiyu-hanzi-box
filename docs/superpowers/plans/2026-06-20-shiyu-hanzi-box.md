# 拾语汉字box Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Chrome MV3 extension that captures selected Chinese text as words or quotes, stores them locally, and exports daily Markdown notes — named 拾语汉字box.

**Architecture:** WXT-based MV3 extension with three entrypoints (background service worker, new-tab dashboard, toolbar popup). All capture paths funnel through a single `capture.ts` service in the background that dedupes words by normalized text, appends occurrences, and writes to `chrome.storage.local`. The dashboard is a React app that reads/writes the same storage and renders words/quotes inboxes with edit/review/archive and pinyin generation. Markdown export (single-day `.md` or zip of daily notes) is a pure module unit-tested with Vitest.

**Tech Stack:** WXT, React 18, TypeScript, Tailwind CSS, `lucide-react`, `pinyin-pro`, `fflate`, Vitest + `WxtVitest()` plugin + `@webext-core/fake-browser`.

---

## File Structure

```
shiyu-hanzi-box/
├── wxt.config.ts                  # manifest (permissions, commands, action), tailwind module
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── tailwind.config.ts
├── postcss.config.js
├── public/                        # generated icons (auto-icons)
├── entrypoints/
│   ├── background/
│   │   └── index.ts               # contextMenus + commands wiring → capture service
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx
│   │   └── Popup.tsx              # two buttons: save word / save quote
│   └── newtab/
│       ├── index.html
│       ├── main.tsx
│       ├── App.tsx                # dashboard shell: header + filters
│       └── components/
│           ├── WordCard.tsx
│           ├── QuoteCard.tsx
│           ├── WordList.tsx
│           ├── QuoteList.tsx
│           ├── Toolbar.tsx        # search + stats + export
│           └── PinyinButton.tsx
├── lib/
│   ├── types.ts                   # WordEntry, QuoteEntry, Occurrence, Status, Source
│   ├── normalize.ts               # text normalization for word dedupe
│   ├── id.ts                      # id generator
│   ├── storage.ts                 # typed storage accessors (defineItem)
│   ├── capture.ts                 # core capture/dedupe logic (background-only)
│   ├── page-context.ts            # injected fn: read selection + sentence + page meta
│   ├── pinyin.ts                  # pinyin-pro wrapper
│   ├── markdown.ts                # daily note rendering
│   └── export.ts                  # fflate zip + downloads trigger
└── tests/
    ├── normalize.test.ts
    ├── capture.test.ts
    ├── markdown.test.ts
    ├── export.test.ts
    └── pinyin.test.ts
```

**Responsibilities:**
- `lib/types.ts` — single source of truth for all data shapes. No runtime logic.
- `lib/normalize.ts` — pure functions, fully unit-tested, no Chrome deps.
- `lib/capture.ts` — the one place that decides "new word vs append occurrence vs new quote". Pure logic over an injected storage interface, so it's testable without Chrome.
- `lib/page-context.ts` — a `defineBackground`-registered function serialized into the active tab via `scripting.executeScript`. Reads `window.getSelection()`, the surrounding sentence (expand selection to nearest sentence-ending punctuation), and `document.title`/`location`.
- `entrypoints/background/index.ts` — glue: registers context menus + command listeners, calls `capture` + sets badge/toast.
- `lib/markdown.ts` / `lib/export.ts` — pure, unit-tested, no Chrome deps in the render path.

---

## Task 0: Scaffold WXT + React + TS + Tailwind + Vitest

> **Note on color rendering:** The `text-jade-*` / `bg-jade-*` Tailwind utilities used in Tasks 7, 11, and 12 are defined by the `@theme` block added in Task 13. Until Task 13 lands, Tailwind v4 silently ignores unknown utility classes — so the build will succeed but those colors won't render. This is expected; do not treat it as a bug during intermediate builds. If you prefer to see colors from the start, do Task 13's `styles.css` edit immediately after Task 0.

**Files:**
- Create: `package.json`, `wxt.config.ts`, `tsconfig.json`, `vitest.config.ts`, `tailwind.config.ts`, `postcss.config.js`, `.vscode/extensions.json`
- Create: `entrypoints/.gitkeep` (so the dir exists before entrypoints land)

- [ ] **Step 1: Initialize WXT project with React template**

Run from `/Users/viphat/projects/shiyu-hanzi-box`:
```bash
npx --yes wxt@latest init . --template react --pm npm
```
If it prompts about a non-empty directory (we have `.gitignore` + `docs/`), confirm overwrite. This generates `package.json`, `wxt.config.ts`, `tsconfig.json`, `entrypoints/popup/`, and example files.

- [ ] **Step 2: Install runtime + dev dependencies**

```bash
npm install lucide-react pinyin-pro fflate
npm install -D tailwindcss @tailwindcss/vite vitest @webext-core/fake-browser
```

- [ ] **Step 3: Configure Tailwind v4 via Vite plugin in `wxt.config.ts`**

Overwrite `wxt.config.ts` with:
```ts
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/auto-icons'],
  srcDir: 'src',
  manifest: {
    name: '拾语汉字box',
    description: 'Capture Chinese words and quotes while reading; export daily Markdown notes.',
    permissions: ['contextMenus', 'storage', 'activeTab', 'scripting', 'downloads', 'unlimitedStorage'],
    commands: {
      'save-word': {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Save selection as a word',
      },
      'save-quote': {
        suggested_key: { default: 'Ctrl+Shift+Q', mac: 'Command+Shift+Q' },
        description: 'Save selection as a quote',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
```
Then remove `srcDir: 'src'` if `wxt init` created `entrypoints/` at repo root instead — match wherever WXT put the popup. **Decide concretely:** keep WXT's default layout (entrypoints at root). Do not add `srcDir`.

Final `wxt.config.ts` (root entrypoints, no srcDir):
```ts
import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  modules: ['@wxt-dev/auto-icons'],
  manifest: {
    name: '拾语汉字box',
    description: 'Capture Chinese words and quotes while reading; export daily Markdown notes.',
    permissions: ['contextMenus', 'storage', 'activeTab', 'scripting', 'downloads', 'unlimitedStorage'],
    commands: {
      'save-word': {
        suggested_key: { default: 'Ctrl+Shift+S', mac: 'Command+Shift+S' },
        description: 'Save selection as a word',
      },
      'save-quote': {
        suggested_key: { default: 'Ctrl+Shift+Q', mac: 'Command+Shift+Q' },
        description: 'Save selection as a quote',
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
```

- [ ] **Step 4: Add Tailwind import + configure `vitest.config.ts`**

Create `vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
});
```

- [ ] **Step 5: Create `tests/` dir and a placeholder `lib/` dir**

```bash
mkdir -p tests lib
```

- [ ] **Step 6: Verify dev server + build work**

Run:
```bash
npm run dev
```
Expected: WXT dev server starts, prints a Chrome path to load as unpacked extension. Stop it (Ctrl+C). Then:
```bash
npm run build
```
Expected: builds to `.output/chrome-mv3/` with a `manifest.json` containing `name: "拾语汉字box"` and the permissions above. Run `cat .output/chrome-mv3/manifest.json` to confirm.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold WXT + React + Tailwind + Vitest"
```

---

## Task 1: Types module

**Files:**
- Create: `lib/types.ts`

- [ ] **Step 1: Write the type module**

`lib/types.ts`:
```ts
export type Status = 'inbox' | 'reviewed' | 'archived';

/** Captured once per save. Words aggregate many of these. */
export interface Occurrence {
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number; // epoch ms
}

/** Base fields shared by words and quotes. */
interface EntryBase {
  id: string;
  text: string;
  tags: string[];
  note: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  pinyin?: string;
}

export interface WordEntry extends EntryBase {
  kind: 'word';
  /** Dedupe key: normalize(text). Stored to avoid recomputation. */
  normalized: string;
  occurrences: Occurrence[];
}

export interface QuoteEntry extends EntryBase {
  kind: 'quote';
  category: string; // freeform; defaults to 'uncategorized'
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
}

export type Entry = WordEntry | QuoteEntry;

/** Shape persisted in chrome.storage.local. */
export interface Inbox {
  words: WordEntry[];
  quotes: QuoteEntry[];
}

export const EMPTY_INBOX: Inbox = { words: [], quotes: [] };
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add entry type definitions"
```

---

## Task 2: Text normalization (TDD)

**Files:**
- Create: `lib/normalize.ts`
- Test: `tests/normalize.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/normalize.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { normalizeText } from '../lib/normalize';

describe('normalizeText', () => {
  it('trims surrounding whitespace', () => {
    expect(normalizeText('  你好  ')).toBe('你好');
  });

  it('collapses internal whitespace', () => {
    expect(normalizeText('你\n好\t世 界')).toBe('你好世界');
  });

  it('strips leading/trailing CJK punctuation', () => {
    expect(normalizeText('"你好"。')).toBe('你好');
    expect(normalizeText('「你好」')).toBe('你好');
    expect(normalizeText('（你好）')).toBe('你好');
  });

  it('does not strip internal CJK punctuation', () => {
    expect(normalizeText('你好，世界')).toBe('你好，世界');
  });

  it('converts full-width latin to half-width', () => {
    expect(normalizeText('ＡＢＣ')).toBe('ABC');
  });

  it('lowercases latin letters', () => {
    expect(normalizeText('Hello')).toBe('hello');
  });

  it('is idempotent', () => {
    const once = normalizeText('  ＡＢＣ。 ');
    expect(normalizeText(once)).toBe(once);
  });

  it('handles empty string', () => {
    expect(normalizeText('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/normalize.test.ts`
Expected: FAIL — `normalizeText` not defined / module not found.

- [ ] **Step 3: Write minimal implementation**

`lib/normalize.ts`:
```ts
// CJK + common punctuation to strip only at the edges.
const EDGE_PUNCT = /[\s\u3000-\u303f\uff00-\uffef!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~，。！？、；：""''（）【】《》〈〉「」『』〔〕…—·]+/;

const FULLWIDTH_OFFSET = 0xfee0;

function toHalfWidth(ch: string): string {
  const code = ch.charCodeAt(0);
  // Full-width ASCII range U+FF01–U+FF5E -> ASCII U+0021–U+007E
  if (code >= 0xff01 && code <= 0xff5e) return String.fromCharCode(code - FULLWIDTH_OFFSET);
  // Ideographic space U+3000 -> regular space
  if (code === 0x3000) return ' ';
  return ch;
}

export function normalizeText(input: string): string {
  let s = input
    .split('')
    .map(toHalfWidth)
    .join('');
  s = s.replace(/\s+/g, ''); // collapse all whitespace (Chinese has no word spaces)
  s = s.toLowerCase();
  // strip leading/trailing punctuation (ASCII + CJK) until stable
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(new RegExp('^' + EDGE_PUNCT.source, 'u'), '');
    s = s.replace(new RegExp(EDGE_PUNCT.source + '$', 'u'), '');
  }
  return s;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/normalize.test.ts`
Expected: PASS (all 8 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/normalize.ts tests/normalize.test.ts
git commit -m "feat: text normalization for word dedupe"
```

---

## Task 3: ID generator + storage layer

**Files:**
- Create: `lib/id.ts`
- Create: `lib/storage.ts`

- [ ] **Step 1: Write `lib/id.ts`**

```ts
/** Collision-resistant id without a dependency. */
export function makeId(): string {
  return (
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10)
  );
}
```

- [ ] **Step 2: Write `lib/storage.ts` using WXT's storage API**

```ts
import { storage } from 'wxt/storage';
import type { Inbox } from './types';
import { EMPTY_INBOX } from './types';

export const inboxStorage = storage.defineItem<Inbox>('local:inbox', {
  fallback: EMPTY_INBOX,
});

export async function getInbox(): Promise<Inbox> {
  return inboxStorage.getValue();
}

export async function setInbox(next: Inbox): Promise<void> {
  await inboxStorage.setValue(next);
}

/** Atomic-ish update: read-modify-write under a simple in-process lock. */
let writeChain: Promise<unknown> = Promise.resolve();
export async function mutateInbox(
  fn: (inbox: Inbox) => Inbox | Promise<Inbox>,
): Promise<Inbox> {
  const run = writeChain.then(() => getInbox()).then((inbox) => fn(inbox));
  writeChain = run.then(setInbox);
  return run;
}
```

- [ ] **Step 3: Typecheck + verify prepare types exist**

Run: `npx wxt prepare && npx tsc --noEmit`
Expected: no errors. `.wxt/types/` regenerated.

- [ ] **Step 4: Commit**

```bash
git add lib/id.ts lib/storage.ts
git commit -m "feat: storage layer with serialized writes"
```

---

## Task 4: Capture/dedupe logic (TDD)

**Files:**
- Create: `lib/capture.ts`
- Test: `tests/capture.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/capture.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveWord, saveQuote } from '../lib/capture';
import { getInbox } from '../lib/storage';

beforeEach(() => {
  fakeBrowser.reset();
});

const src = {
  sourceTitle: 'Page',
  sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com',
  surrounding: 'context here',
  capturedAt: 1000,
};

describe('saveWord', () => {
  it('creates a new word on first capture', async () => {
    await saveWord('你好', src);
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('你好');
    expect(inbox.words[0].normalized).toBe('你好');
    expect(inbox.words[0].occurrences).toHaveLength(1);
    expect(inbox.words[0].status).toBe('inbox');
  });

  it('dedupes by normalized text and appends an occurrence', async () => {
    await saveWord('你好', src);
    await saveWord('  你好。 ', { ...src, sourceUrl: 'https://example.com/b', capturedAt: 2000 });
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].occurrences).toHaveLength(2);
    expect(inbox.words[0].occurrences[1].sourceUrl).toBe('https://example.com/b');
  });

  it('does not add duplicate occurrence when identical source+text within 5s', async () => {
    await saveWord('你好', src);
    await saveWord('你好', src);
    const inbox = await getInbox();
    expect(inbox.words[0].occurrences).toHaveLength(1);
  });

  it('ignores empty/whitespace text', async () => {
    await saveWord('   ', src);
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(0);
  });
});

describe('saveQuote', () => {
  it('always creates a new independent quote', async () => {
    await saveQuote('学而时习之', src);
    await saveQuote('学而时习之', src);
    const inbox = await getInbox();
    expect(inbox.quotes).toHaveLength(2);
    expect(inbox.quotes[0].category).toBe('uncategorized');
  });

  it('ignores empty text', async () => {
    await saveQuote('', src);
    expect((await getInbox()).quotes).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/capture.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Write minimal implementation**

`lib/capture.ts`:
```ts
import { makeId } from './id';
import { normalizeText } from './normalize';
import { mutateInbox } from './storage';
import type { Occurrence, WordEntry, QuoteEntry } from './types';

export interface SourceInfo {
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number;
}

const DEDUPE_WINDOW_MS = 5000;

export async function saveWord(text: string, src: SourceInfo): Promise<WordEntry | null> {
  const normalized = normalizeText(text);
  if (normalized.length === 0) return null;

  let result: WordEntry | null = null;
  await mutateInbox((inbox) => {
    const idx = inbox.words.findIndex((w) => w.normalized === normalized);
    if (idx === -1) {
      const now = src.capturedAt;
      const word: WordEntry = {
        id: makeId(),
        kind: 'word',
        text: text.trim(),
        normalized,
        tags: [],
        note: '',
        status: 'inbox',
        createdAt: now,
        updatedAt: now,
        occurrences: [{ ...src }],
        pinyin: undefined,
      };
      result = word;
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
      result = existing;
      return inbox;
    }

    const occurrence: Occurrence = { ...src };
    const updated: WordEntry = {
      ...existing,
      occurrences: [occurrence, ...existing.occurrences],
      updatedAt: src.capturedAt,
    };
    result = updated;
    const words = [...inbox.words];
    words[idx] = updated;
    return { ...inbox, words };
  });
  return result;
}

export async function saveQuote(text: string, src: SourceInfo): Promise<QuoteEntry | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const now = src.capturedAt;
  const quote: QuoteEntry = {
    id: makeId(),
    kind: 'quote',
    text: trimmed,
    category: 'uncategorized',
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
  };
  await mutateInbox((inbox) => ({ ...inbox, quotes: [quote, ...inbox.quotes] }));
  return quote;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/capture.test.ts`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/capture.ts tests/capture.test.ts
git commit -m "feat: word dedupe + quote capture logic"
```

---

## Task 5: Page context reader (injected function)

**Files:**
- Create: `lib/page-context.ts`

- [ ] **Step 1: Write the injected function**

This function is serialized and run in the active tab via `chrome.scripting.executeScript`. It must be self-contained (no closure imports).

`lib/page-context.ts`:
```ts
export interface PageContext {
  text: string;
  surrounding: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
}

/**
 * Runs in the PAGE context via scripting.executeScript({ func }).
 * Must not reference outer scope.
 */
export function readPageContext(): PageContext | null {
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text) return null;

  // Surrounding sentence: expand to nearest sentence boundary from selection anchor.
  let surrounding = '';
  if (sel && sel.anchorNode && sel.anchorNode.parentElement) {
    const el = sel.anchorNode.parentElement;
    const full = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
    const anchorOffset = sel.anchorOffset;
    // crude: take ±80 chars around anchor
    const start = Math.max(0, anchorOffset - 80);
    const end = Math.min(full.length, anchorOffset + text.length + 80);
    surrounding = full.slice(start, end).trim();
  }

  let domain = '';
  try {
    domain = location.hostname;
  } catch {
    domain = '';
  }

  return {
    text,
    surrounding,
    sourceTitle: document.title || domain || '',
    sourceUrl: location.href,
    sourceDomain: domain,
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/page-context.ts
git commit -m "feat: page-context reader for selection capture"
```

---

## Task 6: Background entrypoint — context menus + commands

**Files:**
- Create: `entrypoints/background/index.ts`
- Create: `entrypoints/background/capture-handler.ts`
- Test: `tests/capture-handler.test.ts`

- [ ] **Step 1: Write the capture handler**

`entrypoints/background/capture-handler.ts`:
```ts
import type { Tabs } from 'wxt/browser';
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
export type ActiveTab = Tabs.Tab;
```

- [ ] **Step 2: Write the background entrypoint**

`entrypoints/background/index.ts`:
```ts
import { handleCapture, MENU_SAVE_WORD, MENU_SAVE_QUOTE } from './capture-handler';

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: MENU_SAVE_WORD,
      title: 'Save as word (拾语汉字box)',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: MENU_SAVE_QUOTE,
      title: 'Save as quote (拾语汉字box)',
      contexts: ['selection'],
    });
  });

  browser.contextMenus.onClicked.addListener((info) => {
    if (info.menuItemId === MENU_SAVE_WORD) void handleCapture('word');
    else if (info.menuItemId === MENU_SAVE_QUOTE) void handleCapture('quote');
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'save-word') void handleCapture('word');
    else if (command === 'save-quote') void handleCapture('quote');
  });
});
```

- [ ] **Step 3: Verify build produces correct manifest**

Run: `npm run build`
Then check the manifest has `commands`, `permissions`, and a `background` service worker:
```bash
cat .output/chrome-mv3/manifest.json
```
Expected: includes `"contextMenus"`, `"scripting"`, `"commands"` block, and `"background": { "service_worker": ... }`.

- [ ] **Step 4: Write capture-path tests (mocked Chrome APIs)**

`tests/capture-handler.test.ts`:
```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { handleCapture } from '../entrypoints/background/capture-handler';
import { getInbox } from '../lib/storage';
import { readPageContext } from '../lib/page-context';

const GOOD_CTX = {
  text: '你好',
  surrounding: 'context',
  sourceTitle: 'Page',
  sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com',
};

beforeEach(() => {
  fakeBrowser.reset();
  // default happy path: active tab exists, scripting returns a selection
  fakeBrowser.tabs.query.setReturnValue([{ id: 1, active: true } as any]);
  fakeBrowser.scripting.executeScript.setReturnValue([
    { result: GOOD_CTX } as any,
  ]);
});

describe('handleCapture — word path', () => {
  it('saves the selection as a word', async () => {
    await handleCapture('word');
    const inbox = await getInbox();
    expect(inbox.words).toHaveLength(1);
    expect(inbox.words[0].text).toBe('你好');
  });

  it('returns no-selection when the page has no selection', async () => {
    fakeBrowser.scripting.executeScript.setReturnValue([{ result: null } as any]);
    await handleCapture('word');
    expect((await getInbox()).words).toHaveLength(0);
  });

  it('handles restricted pages (scripting rejects) without throwing', async () => {
    fakeBrowser.scripting.executeScript.setReject(new Error('cannot access'));
    await expect(handleCapture('word')).resolves.not.toThrow();
    expect((await getInbox()).words).toHaveLength(0);
  });

  it('handles no active tab', async () => {
    fakeBrowser.tabs.query.setReturnValue([]);
    await handleCapture('word');
    expect((await getInbox()).words).toHaveLength(0);
  });
});

describe('handleCapture — quote path', () => {
  it('saves the selection as a quote', async () => {
    await handleCapture('quote');
    expect((await getInbox()).quotes).toHaveLength(1);
  });
});
```
> If `fakeBrowser.scripting.executeScript.setReturnValue` / `setReject` API names differ in the installed `@webext-core/fake-browser` version, adapt to the actual API (it may be `mockReturnValue`/`mockRejectedValue` since these are vi mocks). Run the test once, read the error, and adjust the method names — the assertion intent stays the same.

- [ ] **Step 5: Run capture-handler tests**

Run: `npx vitest run tests/capture-handler.test.ts`
Expected: PASS (5 tests). Fix the mock method names if needed (see note above).

- [ ] **Step 6: Commit**

```bash
git add entrypoints/background tests/capture-handler.test.ts
git commit -m "feat: background entrypoint with context menus and commands"
```

---

## Task 7: Toolbar popup

**Files:**
- Create: `entrypoints/popup/index.html`
- Create: `entrypoints/popup/main.tsx`
- Create: `entrypoints/popup/Popup.tsx`

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>拾语汉字box</title>
  </head>
  <body class="w-72 p-4 bg-white text-ink">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import '@/styles.css'; // tailwind entry

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
```
(The `@/styles.css` path is WXT's alias for a file at `styles.css` in root; create that file in Task 9. For now the build will fail until Task 9 — that's expected. **Reorder:** create `styles.css` in this task.)

Create `styles.css` at repo root now:
```css
@import "tailwindcss";
```
And update `main.tsx` import to `import '../styles.css'` if the `@/` alias isn't configured. Verify alias by checking WXT's generated tsconfig paths in `.wxt/types/tsconfig.json` — use whichever resolves. **Concrete decision:** use relative `../styles.css` to avoid alias ambiguity.

Final `main.tsx`:
```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { Popup } from './Popup';
import '../styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Popup />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Write `Popup.tsx`**

```tsx
import { useState } from 'react';
import { Type, Quote, Loader2 } from 'lucide-react';
import { handleCapture } from '@/entrypoints/background/capture-handler';

export function Popup() {
  const [busy, setBusy] = useState<'word' | 'quote' | null>(null);
  const [msg, setMsg] = useState<string>('');

  async function go(kind: 'word' | 'quote') {
    setBusy(kind);
    setMsg('');
    // Send to background so badge/storage behave identically to other paths.
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
```

> Note: importing from `@/entrypoints/background/capture-handler` runs that module's badge code in the popup context, which is fine (the popup also has `action` access). The `defineBackground` import must NOT be imported in popup. `capture-handler.ts` only imports `browser` (global) and pure libs, so it's safe.

- [ ] **Step 4: Verify popup builds**

Run: `npm run build`
Expected: build succeeds; `.output/chrome-mv3/popup.html` exists.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/popup styles.css
git commit -m "feat: toolbar popup with word/quote save buttons"
```

---

## Task 8: Pinyin module (TDD)

**Files:**
- Create: `lib/pinyin.ts`
- Test: `tests/pinyin.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/pinyin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { toPinyin } from '../lib/pinyin';

describe('toPinyin', () => {
  it('returns pinyin with tone marks for Chinese text', () => {
    expect(toPinyin('你好')).toBe('nǐ hǎo');
  });

  it('passes through non-Chinese characters', () => {
    expect(toPinyin('你好 world')).toBe('nǐ hǎo world');
  });

  it('returns empty string for empty input', () => {
    expect(toPinyin('')).toBe('');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/pinyin.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`lib/pinyin.ts`:
```ts
import { pinyin } from 'pinyin-pro';

export function toPinyin(text: string): string {
  return pinyin(text, { toneType: 'symbol', type: 'array' }).join(' ');
}
```
> If test 2 fails because pinyin-pro mangles spaces, adjust to `pinyin(text, { toneType: 'symbol' })` (string mode preserves non-CJK). Verify with the test run; keep whichever passes all three.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/pinyin.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/pinyin.ts tests/pinyin.test.ts
git commit -m "feat: pinyin generation via pinyin-pro"
```

---

## Task 9: Markdown rendering (TDD)

**Files:**
- Create: `lib/markdown.ts`
- Test: `tests/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/markdown.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { renderDay } from '../lib/markdown';
import type { WordEntry, QuoteEntry } from '../lib/types';

const day = '2026-06-20';

const word: WordEntry = {
  id: 'w1', kind: 'word', text: '你好', normalized: '你好',
  tags: ['greeting'], note: 'common hello', status: 'inbox',
  createdAt: 1, updatedAt: 1,
  occurrences: [
    { sourceTitle: 'A', sourceUrl: 'https://a.com/1', sourceDomain: 'a.com', surrounding: 's1', capturedAt: 1 },
    { sourceTitle: 'B', sourceUrl: 'https://b.com/2', sourceDomain: 'b.com', surrounding: 's2', capturedAt: 2 },
  ],
  pinyin: 'nǐ hǎo',
};

const quote: QuoteEntry = {
  id: 'q1', kind: 'quote', text: '学而时习之', category: '论语',
  tags: [], note: '', status: 'inbox',
  createdAt: 1, updatedAt: 1,
  sourceTitle: 'Lunyu', sourceUrl: 'https://lunyu.com', sourceDomain: 'lunyu.com',
  surrounding: '不亦说乎',
};

describe('renderDay', () => {
  it('produces frontmatter with the date', () => {
    const md = renderDay(day, [word], []);
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('date: 2026-06-20');
  });

  it('lists a word once with all source links and a review checkbox', () => {
    const md = renderDay(day, [word], []);
    expect(md).toContain('## Words');
    expect(md).toContain('- [ ] **你好**');
    expect(md).toContain('https://a.com/1');
    expect(md).toContain('https://b.com/2');
    expect(md).toContain('nǐ hǎo');
    expect(md).toContain('#greeting');
  });

  it('lists each quote as its own entry', () => {
    const md = renderDay(day, [], [quote]);
    expect(md).toContain('## Quotes');
    expect(md).toContain('学而时习之');
    expect(md).toContain('论语');
    expect(md).toContain('https://lunyu.com');
  });

  it('omits empty sections', () => {
    const md = renderDay(day, [], []);
    expect(md).not.toContain('## Words');
    expect(md).not.toContain('## Quotes');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`lib/markdown.ts`:
```ts
import type { WordEntry, QuoteEntry } from './types';

function esc(s: string): string {
  // minimal markdown-safe: escape pipes in tables, keep simple here
  return s.replace(/\|/g, '\\|');
}

export function renderDay(date: string, words: WordEntry[], quotes: QuoteEntry[]): string {
  const lines: string[] = [];
  lines.push('---', `date: ${date}`, `words: ${words.length}`, `quotes: ${quotes.length}`, '---', '');

  if (words.length > 0) {
    lines.push('## Words', '');
    for (const w of words) {
      const py = w.pinyin ? ` _${w.pinyin}_` : '';
      const tags = w.tags.length ? ' ' + w.tags.map((t) => `#${t}`).join(' ') : '';
      lines.push(`- [ ] **${esc(w.text)}**${py}${tags}`);
      if (w.note) lines.push(`  - ${esc(w.note)}`);
      for (const o of w.occurrences) {
        lines.push(`  - [${esc(o.sourceTitle || o.sourceDomain)}](${o.sourceUrl})`);
      }
      lines.push('');
    }
  }

  if (quotes.length > 0) {
    lines.push('## Quotes', '');
    for (const q of quotes) {
      const tags = q.tags.length ? ' ' + q.tags.map((t) => `#${t}`).join(' ') : '';
      lines.push(`- [ ] > ${esc(q.text)}`);
      lines.push(`  - _category:_ ${esc(q.category)}${tags}`);
      if (q.note) lines.push(`  - ${esc(q.note)}`);
      lines.push(`  - [${esc(q.sourceTitle || q.sourceDomain)}](${q.sourceUrl})`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Partition entries into per-day buckets keyed by YYYY-MM-DD (local). */
export function groupByDay(capturedAt: number): string {
  const d = new Date(capturedAt);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/markdown.ts tests/markdown.test.ts
git commit -m "feat: daily markdown rendering"
```

---

## Task 10: Export module — single file + zip (TDD)

**Files:**
- Create: `lib/export.ts`
- Test: `tests/export.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/export.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildExportMap, zipBytes } from '../lib/export';
import type { WordEntry, QuoteEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1', kind: 'word', text: '你好', normalized: '你好',
  tags: [], note: '', status: 'inbox', createdAt: Date.UTC(2026, 5, 20), updatedAt: 1,
  occurrences: [{ sourceTitle: 'A', sourceUrl: 'https://a.com', sourceDomain: 'a.com', surrounding: '', capturedAt: Date.UTC(2026, 5, 20) }],
};

const quote: QuoteEntry = {
  id: 'q1', kind: 'quote', text: 'x', category: 'uncategorized',
  tags: [], note: '', status: 'inbox', createdAt: Date.UTC(2026, 5, 21), updatedAt: 1,
  sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
};

describe('buildExportMap', () => {
  it('groups entries into daily file paths', () => {
    const map = buildExportMap([word], [quote]);
    expect(map.has('daily/2026-06-20.md')).toBe(true);
    expect(map.has('daily/2026-06-21.md')).toBe(true);
    expect(map.get('daily/2026-06-20.md')!).toContain('## Words');
    expect(map.get('daily/2026-06-21.md')!).toContain('## Quotes');
  });

  it('skips archived entries', () => {
    const archived = { ...word, status: 'archived' as const };
    const map = buildExportMap([archived], []);
    expect(map.size).toBe(0);
  });
});

describe('zipBytes', () => {
  it('produces a non-empty zip with the given files', async () => {
    const bytes = await zipBytes(new Map([['daily/2026-06-20.md', '# hi']]));
    expect(bytes.byteLength).toBeGreaterThan(0);
    // zip magic number
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/export.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write minimal implementation**

`lib/export.ts`:
```ts
import { zip } from 'fflate';
import { renderDay, groupByDay } from './markdown';
import type { WordEntry, QuoteEntry, Inbox } from './types';

interface DayBucket {
  words: WordEntry[];
  quotes: QuoteEntry[];
}

export function buildExportMap(words: WordEntry[], quotes: QuoteEntry[]): Map<string, string> {
  const buckets = new Map<string, DayBucket>();
  const touch = (date: string) => {
    let b = buckets.get(date);
    if (!b) {
      b = { words: [], quotes: [] };
      buckets.set(date, b);
    }
    return b;
  };

  for (const w of words) {
    if (w.status === 'archived') continue;
    const date = groupByDay(w.occurrences[0]?.capturedAt ?? w.createdAt);
    touch(date).words.push(w);
  }
  for (const q of quotes) {
    if (q.status === 'archived') continue;
    const date = groupByDay(q.createdAt);
    touch(date).quotes.push(q);
  }

  const out = new Map<string, string>();
  for (const [date, b] of buckets) {
    out.set(`daily/${date}.md`, renderDay(date, b.words, b.quotes));
  }
  return out;
}

export async function zipBytes(files: Map<string, string>): Promise<Uint8Array> {
  const obj: Record<string, Uint8Array> = {};
  for (const [path, content] of files) {
    obj[path] = new TextEncoder().encode(content);
  }
  return new Promise((resolve, reject) => {
    zip(obj, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

/** Build a full export of the entire inbox as a zip. */
export async function exportInboxAsZip(inbox: Inbox): Promise<Uint8Array> {
  return zipBytes(buildExportMap(inbox.words, inbox.quotes));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/export.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/export.ts tests/export.test.ts
git commit -m "feat: daily export map + zip generation"
```

---

## Task 11: New-tab dashboard shell

**Files:**
- Create: `entrypoints/newtab/index.html`
- Create: `entrypoints/newtab/main.tsx`
- Create: `entrypoints/newtab/App.tsx`
- Create: `entrypoints/newtab/hooks/useInbox.ts`

- [ ] **Step 1: Write `index.html`**

```html
<!doctype html>
<html lang="zh">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>拾语汉字box · 收藏箱</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Write `main.tsx`**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import '../styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 3: Write the `useInbox` hook**

`entrypoints/newtab/hooks/useInbox.ts`:
```ts
import { useEffect, useState, useCallback } from 'react';
import { inboxStorage } from '@/lib/storage';
import type { Inbox } from '@/lib/types';
import { EMPTY_INBOX } from '@/lib/types';

export function useInbox() {
  const [inbox, setInbox] = useState<Inbox>(EMPTY_INBOX);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    inboxStorage.getValue().then((v) => {
      if (mounted) {
        setInbox(v);
        setLoading(false);
      }
    });
    const unwatch = inboxStorage.watch((next) => {
      if (mounted) setInbox(next ?? EMPTY_INBOX);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const mutate = useCallback(async (fn: (i: Inbox) => Inbox) => {
    const current = await inboxStorage.getValue();
    await inboxStorage.setValue(fn(current));
  }, []);

  return { inbox, loading, mutate };
}
```

- [ ] **Step 4: Write a minimal `App.tsx` (shell; full UI in Task 12)**

```tsx
import { useInbox } from './hooks/useInbox';

export function App() {
  const { inbox, loading } = useInbox();
  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;
  return (
    <div className="min-h-screen bg-gray-50 text-ink">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <h1 className="text-xl font-semibold text-jade-700">拾语汉字box</h1>
          <p className="text-sm text-gray-500">{inbox.words.length} words · {inbox.quotes.length} quotes</p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-6 py-6">
        <p className="text-sm text-gray-500">Dashboard wiring complete. UI populated in next task.</p>
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Verify build**

Run: `npm run build`
Expected: `.output/chrome-mv3/newtab.html` exists; manifest has `chrome_url_overrides: { newtab: "newtab.html" }`.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/newtab
git commit -m "feat: new-tab dashboard shell with live storage hook"
```

---

## Task 12: Dashboard components — Toolbar, WordCard, QuoteCard, lists

**Files:**
- Create: `entrypoints/newtab/components/Toolbar.tsx`
- Create: `entrypoints/newtab/components/WordCard.tsx`
- Create: `entrypoints/newtab/components/QuoteCard.tsx`
- Create: `entrypoints/newtab/components/WordList.tsx`
- Create: `entrypoints/newtab/components/QuoteList.tsx`
- Create: `entrypoints/newtab/components/PinyinButton.tsx`
- Modify: `entrypoints/newtab/App.tsx`

- [ ] **Step 1: Write `PinyinButton.tsx`**

```tsx
import { Sparkles, Loader2 } from 'lucide-react';
import { useState } from 'react';
import { toPinyin } from '@/lib/pinyin';

export function PinyinButton({ text, onGenerated, existing }: {
  text: string;
  existing?: string;
  onGenerated: (p: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (existing) return <span className="text-xs italic text-jade-600">{existing}</span>;

  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        setBusy(true);
        const p = toPinyin(text);
        onGenerated(p);
        setBusy(false);
      }}
      className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-jade-600"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
      pinyin
    </button>
  );
}
```

- [ ] **Step 2: Write `WordCard.tsx`**

```tsx
import { useState } from 'react';
import { Check, Archive, Trash2, ChevronDown, ChevronRight, Tag } from 'lucide-react';
import type { WordEntry } from '@/lib/types';
import { PinyinButton } from './PinyinButton';

export function WordCard({ word, onUpdate, onDelete }: {
  word: WordEntry;
  onUpdate: (patch: Partial<WordEntry>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState(word.note);

  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button onClick={() => setExpanded(!expanded)} className="text-gray-400 hover:text-gray-600">
              {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            <span className="text-lg font-medium text-ink">{word.text}</span>
            <PinyinButton text={word.text} existing={word.pinyin} onGenerated={(p) => onUpdate({ pinyin: p })} />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {word.tags.map((t) => (
              <span key={t} className="rounded bg-jade-50 px-1.5 py-0.5 text-xs text-jade-700">#{t}</span>
            ))}
            <span className="text-xs text-gray-400">{word.occurrences.length}×</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {word.status !== 'reviewed' && (
            <button title="Mark reviewed" onClick={() => onUpdate({ status: 'reviewed' })}
              className="rounded p-1 text-gray-400 hover:bg-green-50 hover:text-green-600">
              <Check className="h-4 w-4" />
            </button>
          )}
          {word.status !== 'archived' && (
            <button title="Archive" onClick={() => onUpdate({ status: 'archived' })}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700">
              <Archive className="h-4 w-4" />
            </button>
          )}
          <button title="Delete" onClick={onDelete}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-3 space-y-2 border-t pt-2 text-sm">
          <ul className="space-y-1">
            {word.occurrences.map((o, i) => (
              <li key={i} className="truncate text-xs text-gray-500">
                <a href={o.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-jade-700">
                  {o.sourceTitle || o.sourceDomain}
                </a>
                {o.surrounding && <span className="text-gray-400"> — {o.surrounding}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            <Tag className="h-3 w-3 text-gray-400" />
            <input
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && tagInput.trim()) {
                  onUpdate({ tags: [...word.tags, tagInput.trim()] });
                  setTagInput('');
                }
              }}
              placeholder="add tag…"
              className="w-32 border-b text-xs outline-none focus:border-jade-400"
            />
          </div>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => note !== word.note && onUpdate({ note })}
            placeholder="note…"
            className="w-full resize-none rounded border p-1 text-xs outline-none focus:border-jade-400"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Write `QuoteCard.tsx`**

```tsx
import { useState } from 'react';
import { Check, Archive, Trash2 } from 'lucide-react';
import type { QuoteEntry } from '@/lib/types';

export function QuoteCard({ quote, onUpdate, onDelete }: {
  quote: QuoteEntry;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  onDelete: () => void;
}) {
  const [note, setNote] = useState(quote.note);
  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <blockquote className="border-l-2 border-jade-300 pl-3 text-base text-ink">「{quote.text}」</blockquote>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <input
          value={quote.category}
          onChange={(e) => onUpdate({ category: e.target.value })}
          className="rounded bg-gray-50 px-1 outline-none focus:bg-white"
        />
        {quote.sourceUrl && (
          <a href={quote.sourceUrl} target="_blank" rel="noreferrer" className="hover:text-jade-700">
            {quote.sourceTitle || quote.sourceDomain}
          </a>
        )}
      </div>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== quote.note && onUpdate({ note })}
        placeholder="note…"
        rows={2}
        className="mt-2 w-full resize-none rounded border p-1 text-xs outline-none focus:border-jade-400"
      />
      <div className="mt-1 flex justify-end gap-1">
        {quote.status !== 'reviewed' && (
          <button onClick={() => onUpdate({ status: 'reviewed' })} className="rounded p-1 hover:bg-green-50 hover:text-green-600"><Check className="h-4 w-4" /></button>
        )}
        {quote.status !== 'archived' && (
          <button onClick={() => onUpdate({ status: 'archived' })} className="rounded p-1 hover:bg-gray-100"><Archive className="h-4 w-4" /></button>
        )}
        <button onClick={onDelete} className="rounded p-1 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Write `WordList.tsx` and `QuoteList.tsx`**

`WordList.tsx`:
```tsx
import type { WordEntry } from '@/lib/types';
import { WordCard } from './WordCard';

export function WordList({ words, onUpdate, onDelete }: {
  words: WordEntry[];
  onUpdate: (id: string, patch: Partial<WordEntry>) => void;
  onDelete: (id: string) => void;
}) {
  if (words.length === 0) return <p className="py-8 text-center text-sm text-gray-400">No words yet. Select text on any page and save it.</p>;
  return (
    <div className="space-y-2">
      {words.map((w) => (
        <WordCard key={w.id} word={w} onUpdate={(p) => onUpdate(w.id, p)} onDelete={() => onDelete(w.id)} />
      ))}
    </div>
  );
}
```

`QuoteList.tsx`:
```tsx
import type { QuoteEntry } from '@/lib/types';
import { QuoteCard } from './QuoteCard';

export function QuoteList({ quotes, onUpdate, onDelete }: {
  quotes: QuoteEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
}) {
  if (quotes.length === 0) return <p className="py-8 text-center text-sm text-gray-400">No quotes yet.</p>;
  return (
    <div className="space-y-2">
      {quotes.map((q) => (
        <QuoteCard key={q.id} quote={q} onUpdate={(p) => onUpdate(q.id, p)} onDelete={() => onDelete(q.id)} />
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Write `Toolbar.tsx` (search, stats, export)**

```tsx
import { Search, Download, FileText } from 'lucide-react';
import type { Inbox } from '@/lib/types';
import { exportInboxAsZip, buildExportMap } from '@/lib/export';

export function Toolbar({ inbox, query, onQuery }: {
  inbox: Inbox;
  query: string;
  onQuery: (q: string) => void;
}) {
  async function downloadZip() {
    const bytes = await exportInboxAsZip(inbox);
    const blob = new Blob([bytes], { type: 'application/zip' });
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({ url, filename: 'shiyu-hanzi-box-export.zip', saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  async function downloadToday() {
    const today = new Date();
    const date = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    const map = buildExportMap(inbox.words, inbox.quotes);
    const md = map.get(`daily/${date}.md`) ?? `# ${date}\n\n_No entries today._\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    await browser.downloads.download({ url, filename: `${date}.md`, saveAs: true });
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search words and quotes…"
          className="w-full rounded-lg border py-2 pl-8 pr-3 text-sm outline-none focus:border-jade-400"
        />
      </div>
      <button onClick={downloadToday} className="inline-flex items-center gap-1 rounded-lg border px-3 py-2 text-sm hover:bg-gray-50">
        <FileText className="h-4 w-4" /> Today
      </button>
      <button onClick={downloadZip} className="inline-flex items-center gap-1 rounded-lg bg-jade-600 px-3 py-2 text-sm text-white hover:bg-jade-700">
        <Download className="h-4 w-4" /> Export zip
      </button>
    </div>
  );
}
```

- [ ] **Step 6: Rewrite `App.tsx` to wire everything**

```tsx
import { useMemo, useState } from 'react';
import { useInbox } from './hooks/useInbox';
import { Toolbar } from './components/Toolbar';
import { WordList } from './components/WordList';
import { QuoteList } from './components/QuoteList';
import type { WordEntry, QuoteEntry, Status } from '@/lib/types';

type Tab = 'words' | 'quotes';
type StatusFilter = 'all' | Status;

export function App() {
  const { inbox, loading, mutate } = useInbox();
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<Tab>('words');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('inbox');

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    const test = (t: string) => q === '' || t.toLowerCase().includes(q);
    const byStatus = (s: Status) => statusFilter === 'all' || s === statusFilter;
    return {
      words: inbox.words.filter((w) => test(w.text) && byStatus(w.status)),
      quotes: inbox.quotes.filter((qq) => (test(qq.text) || test(qq.category)) && byStatus(qq.status)),
    };
  }, [inbox, query, statusFilter]);

  if (loading) return <div className="p-8 text-gray-500">Loading…</div>;

  function updateWord(id: string, patch: Partial<WordEntry>) {
    mutate((i) => ({ ...i, words: i.words.map((w) => (w.id === id ? { ...w, ...patch, updatedAt: Date.now() } : w)) }));
  }
  function deleteWord(id: string) {
    mutate((i) => ({ ...i, words: i.words.filter((w) => w.id !== id) }));
  }
  function updateQuote(id: string, patch: Partial<QuoteEntry>) {
    mutate((i) => ({ ...i, quotes: i.quotes.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: Date.now() } : q)) }));
  }
  function deleteQuote(id: string) {
    mutate((i) => ({ ...i, quotes: i.quotes.filter((q) => q.id !== id) }));
  }

  return (
    <div className="min-h-screen bg-gray-50 text-ink">
      <header className="border-b bg-white">
        <div className="mx-auto max-w-4xl px-6 py-4">
          <h1 className="text-xl font-semibold text-jade-700">拾语汉字box</h1>
          <p className="text-sm text-gray-500">{inbox.words.length} words · {inbox.quotes.length} quotes</p>
        </div>
      </header>
      <main className="mx-auto max-w-4xl space-y-4 px-6 py-6">
        <Toolbar inbox={inbox} query={query} onQuery={setQuery} />

        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border bg-white p-0.5">
            {(['words', 'quotes'] as Tab[]).map((t) => (
              <button key={t} onClick={() => setTab(t)}
                className={`rounded px-3 py-1 text-sm ${tab === t ? 'bg-jade-600 text-white' : 'text-gray-600'}`}>
                {t === 'words' ? `Words (${inbox.words.length})` : `Quotes (${inbox.quotes.length})`}
              </button>
            ))}
          </div>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            className="rounded-lg border bg-white px-2 py-1 text-sm">
            <option value="inbox">Inbox</option>
            <option value="reviewed">Reviewed</option>
            <option value="archived">Archived</option>
            <option value="all">All</option>
          </select>
        </div>

        {tab === 'words'
          ? <WordList words={matches.words} onUpdate={updateWord} onDelete={deleteWord} />
          : <QuoteList quotes={matches.quotes} onUpdate={updateQuote} onDelete={deleteQuote} />}
      </main>
    </div>
  );
}
```

- [ ] **Step 7: Build + verify**

Run: `npm run build`
Expected: success, no TS errors.

- [ ] **Step 8: Commit**

```bash
git add entrypoints/newtab
git commit -m "feat: dashboard UI — toolbar, cards, lists, search, export"
```

---

## Task 13: Tailwind theme — jade accents + Chinese fonts

**Files:**
- Modify: `styles.css`

- [ ] **Step 1: Extend Tailwind v4 theme via CSS `@theme`**

Overwrite `styles.css`:
```css
@import "tailwindcss";

@theme {
  --color-jade-50: #ecfdf5;
  --color-jade-100: #d1fae5;
  --color-jade-200: #a7f3d0;
  --color-jade-300: #6ee7b7;
  --color-jade-400: #34d399;
  --color-jade-500: #10b981;
  --color-jade-600: #059669;
  --color-jade-700: #047857;
  --color-jade-800: #065f46;
  --color-jade-900: #064e3b;
  --color-ink: #1f2937;

  --font-sans: "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Source Han Sans SC",
    "Noto Sans CJK SC", system-ui, sans-serif;
}

body {
  font-family: var(--font-sans);
}
```

- [ ] **Step 2: Verify build still works**

Run: `npm run build`
Expected: success.

- [ ] **Step 3: Commit**

```bash
git add styles.css
git commit -m "style: jade accent palette + CJK font stack"
```

---

## Task 14: Full test suite + final build verification

- [ ] **Step 1: Run the entire test suite**

Run: `npx vitest run`
Expected: ALL tests pass (normalize, capture, pinyin, markdown, export).

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: builds without warnings/errors to `.output/chrome-mv3/`.

- [ ] **Step 3: Inspect final manifest**

Run: `cat .output/chrome-mv3/manifest.json`
Verify it contains:
- `name: "拾语汉字box"`
- `permissions`: contextMenus, storage, activeTab, scripting, downloads, unlimitedStorage
- `commands`: save-word, save-quote
- `chrome_url_overrides.newtab: "newtab.html"`
- `action.default_popup: "popup.html"`
- `background.service_worker`

- [ ] **Step 4: Final commit (if any uncommitted changes)**

```bash
git status
# if clean, nothing to commit; otherwise:
git add -A && git commit -m "chore: verify full suite + build"
```

---

## Task 15: Manual smoke test (documented; run in Chrome)

This is a human/agent verification task in a real browser, not automated.

- [ ] **Step 1: Load the unpacked extension**

Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `.output/chrome-mv3/`.

- [ ] **Step 2: Capture via context menu**

Open any page with Chinese text, select a word, right-click → "Save as word (拾语汉字box)". Confirm the badge flashes green "WORD".

- [ ] **Step 3: Capture via keyboard command**

Select text, press Cmd/Ctrl+Shift+S. Confirm capture. Then test Cmd/Ctrl+Shift+Q for a quote.

- [ ] **Step 4: Capture via popup**

Select text, click the toolbar icon, click "Save as quote". Confirm.

- [ ] **Step 5: Open a new tab → dashboard renders**

Confirm words/quotes appear, search filters, generate-pinyin works, mark-reviewed and archive work, export-today downloads a `.md`, export-zip downloads a `.zip`.

- [ ] **Step 6: Reload the extension, open new tab → data persists**

Confirm storage survived the reload.

- [ ] **Step 7: Open the exported zip — confirm `daily/YYYY-MM-DD.md` files have frontmatter, `## Words`, `## Quotes`, checkboxes, pinyin, tags, source links**

If all pass, the implementation is complete. Record any issues found into a follow-up.
