# Traditional Chinese (Taiwan) Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click Simplified → Traditional Chinese (Taiwan) conversion to Word and Quote cards, mirroring the existing pinyin button.

**Architecture:** A new pure module `lib/traditional.ts` wraps `opencc-js` (lazy-init, memoized converter) and exposes `toTraditionalTaiwan(text)`. The result is cached on the entry via a new optional `traditionalText?: string` field on `EntryBase`. A single `TraditionalButton` component handles both the generator state and the show/hide toggle state, wired into `WordCard` and `QuoteCard`.

**Tech Stack:** `opencc-js@1.3.1` (new runtime dependency), `@types/opencc-js@1.0.3` (new dev dependency), React 19, TypeScript, Vitest.

**Design spec:** `docs/superpowers/specs/2026-06-22-traditional-chinese-conversion-design.md`

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `package.json` | Modify | Add `opencc-js` (deps) and `@types/opencc-js` (devDeps) |
| `lib/types.ts` | Modify | Add `traditionalText?: string` to `EntryBase` |
| `lib/traditional.ts` | Create | Pure module: `toTraditionalTaiwan(text)` wrapping opencc-js |
| `tests/traditional.test.ts` | Create | Unit tests for `toTraditionalTaiwan` |
| `lib/i18n.ts` | Modify | Add 3 keys (`traditional.generate/show/hide`) to `en` and `zh-CN` |
| `tests/i18n.test.ts` | Modify | Add assertions for the 3 new keys in both locales |
| `entrypoints/newtab/components/TraditionalButton.tsx` | Create | Generator + toggle button component |
| `entrypoints/newtab/components/WordCard.tsx` | Modify | Wire in `TraditionalButton` + render Traditional text |
| `entrypoints/newtab/components/QuoteCard.tsx` | Modify | Wire in `TraditionalButton` + render Traditional text |

---

## Task 1: Add opencc-js dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the runtime dependency**

Run from the repo root:

```bash
npm install opencc-js@1.3.1
```

This adds `"opencc-js": "^1.3.1"` to `dependencies` in `package.json` and updates `package-lock.json`.

- [ ] **Step 2: Add the TypeScript types as a dev dependency**

```bash
npm install --save-dev @types/opencc-js@1.0.3
```

This adds `"@types/opencc-js": "^1.0.3"` to `devDependencies`.

- [ ] **Step 3: Verify the install succeeded**

```bash
node -e "const OpenCC = require('opencc-js'); const c = OpenCC.Converter({ from: 'cn', to: 'twp' }); console.log(c('软件'));"
```

Expected output: `軟體`

- [ ] **Step 4: Verify the types resolve**

```bash
npx tsc --noEmit lib/pinyin.ts
```

Expected: no errors (this just confirms `tsc` still runs cleanly with the new types package present).

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add opencc-js for Simplified to Traditional conversion"
```

---

## Task 2: Add `traditionalText` field to `EntryBase`

**Files:**
- Modify: `lib/types.ts:22-31`

- [ ] **Step 1: Add the field to `EntryBase`**

In `lib/types.ts`, the `EntryBase` interface currently looks like this:

```ts
interface EntryBase {
  id: string;
  text: string;
  note: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  pinyin?: string;
  review?: ReviewState;
}
```

Change it to add `traditionalText` right after `pinyin`:

```ts
interface EntryBase {
  id: string;
  text: string;
  note: string;
  status: Status;
  createdAt: number;
  updatedAt: number;
  pinyin?: string;
  /** Cached Simplified→Traditional (Taiwan) form, generated on demand. */
  traditionalText?: string;
  review?: ReviewState;
}
```

Because `WordEntry` and `QuoteEntry` both extend `EntryBase`, both gain the field automatically.

- [ ] **Step 2: Verify the project still compiles**

Run:

```bash
npm run compile
```

Expected: no errors.

- [ ] **Step 3: Verify the full test suite still passes**

```bash
npm test
```

Expected: all existing tests pass (no behavioral change yet).

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add traditionalText field to EntryBase"
```

---

## Task 3: Create `lib/traditional.ts` (TDD)

**Files:**
- Create: `lib/traditional.ts`
- Test: `tests/traditional.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/traditional.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { toTraditionalTaiwan } from '../lib/traditional';

describe('toTraditionalTaiwan', () => {
  it('converts basic Simplified to Traditional', () => {
    expect(toTraditionalTaiwan('学习')).toBe('學習');
  });

  it('applies Taiwan phrase-level variants (twp, not tw)', () => {
    // twp converts 软件 → 軟體 (Taiwan term); plain tw would give 軟件
    expect(toTraditionalTaiwan('软件')).toBe('軟體');
    expect(toTraditionalTaiwan('自行车')).toBe('腳踏車');
  });

  it('handles one-to-many disambiguation by context', () => {
    // 发 → 髮 in the hair context; 干 → 乾 in the toast context
    expect(toTraditionalTaiwan('头发')).toBe('頭髮');
    expect(toTraditionalTaiwan('干杯')).toBe('乾杯');
  });

  it('passes through non-Chinese characters unchanged', () => {
    expect(toTraditionalTaiwan('hello 123')).toBe('hello 123');
  });

  it('returns empty string for empty input', () => {
    expect(toTraditionalTaiwan('')).toBe('');
  });

  it('handles mixed CJK and ASCII', () => {
    expect(toTraditionalTaiwan('Python语言')).toBe('Python語言');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/traditional.test.ts
```

Expected: FAIL — `Cannot find module '../lib/traditional'`.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/traditional.ts`:

```ts
import OpenCC from 'opencc-js';

let cachedConverter: ((text: string) => string) | null = null;

function getConverter(): (text: string) => string {
  if (!cachedConverter) {
    cachedConverter = OpenCC.Converter({ from: 'cn', to: 'twp' });
  }
  return cachedConverter;
}

/**
 * Convert Simplified Chinese text to Taiwan-style Traditional Chinese.
 *
 * Uses opencc-js with the `twp` (Taiwan phrase) config, which applies
 * regional term substitutions (软件 → 軟體) in addition to character-level
 * mapping and one-to-many disambiguation by context (头发 → 頭髮).
 *
 * The converter is built lazily on first call and memoized in module scope,
 * so the dictionary initialization cost is paid once per dashboard session.
 */
export function toTraditionalTaiwan(text: string): string {
  return getConverter()(text);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run tests/traditional.test.ts
```

Expected: PASS — all 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/traditional.ts tests/traditional.test.ts
git commit -m "feat: add toTraditionalTaiwan converter wrapping opencc-js"
```

---

## Task 4: Add i18n keys (TDD)

**Files:**
- Modify: `lib/i18n.ts`
- Test: `tests/i18n.test.ts`

- [ ] **Step 1: Write the failing test**

In `tests/i18n.test.ts`, add a new `it` block inside the existing `describe('i18n messages', ...)` block, after the "falls back to the key when a message is missing" test:

```ts
  it('returns Traditional conversion labels in both locales', () => {
    expect(t('en', 'traditional.generate')).toBe('Traditional');
    expect(t('en', 'traditional.show')).toBe('Show Traditional');
    expect(t('en', 'traditional.hide')).toBe('Hide Traditional');
    expect(t('zh-CN', 'traditional.generate')).toBe('繁體');
    expect(t('zh-CN', 'traditional.show')).toBe('显示繁體');
    expect(t('zh-CN', 'traditional.hide')).toBe('隐藏繁體');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/i18n.test.ts
```

Expected: FAIL — the three `traditional.*` keys are missing from the message maps (the `t()` function falls back to returning the key string itself, so e.g. `t('en', 'traditional.generate')` returns `'traditional.generate'`, not `'Traditional'`).

- [ ] **Step 3: Add the English keys**

In `lib/i18n.ts`, inside the `en: { ... }` block, add these three lines immediately after the `'pinyin.generate': 'Pinyin',` line:

```ts
    'traditional.generate': 'Traditional',
    'traditional.show': 'Show Traditional',
    'traditional.hide': 'Hide Traditional',
```

- [ ] **Step 4: Add the zh-CN keys**

In the same file, inside the `'zh-CN': { ... }` block, add these three lines immediately after the `'pinyin.generate': '注音',` line:

```ts
    'traditional.generate': '繁體',
    'traditional.show': '显示繁體',
    'traditional.hide': '隐藏繁體',
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npx vitest run tests/i18n.test.ts
```

Expected: PASS — all tests pass.

- [ ] **Step 6: Commit**

```bash
git add lib/i18n.ts tests/i18n.test.ts
git commit -m "feat: add i18n keys for Traditional conversion"
```

---

## Task 5: Create `TraditionalButton` component

**Files:**
- Create: `entrypoints/newtab/components/TraditionalButton.tsx`

This component has no unit test, consistent with how `PinyinButton` is handled (only the underlying pure module `lib/pinyin.ts` is tested). It is thin glue over the tested `toTraditionalTaiwan` and the existing `onUpdate` pattern.

- [ ] **Step 1: Create the component**

Create `entrypoints/newtab/components/TraditionalButton.tsx`:

```tsx
import { Sparkles } from 'lucide-react';
import { t } from '@/lib/i18n';
import { toTraditionalTaiwan } from '@/lib/traditional';
import type { UiLocale } from '@/lib/types';

/**
 * One component handling both states, modeled on PinyinButton:
 * - When `existing` is absent: a generator button that converts on click.
 * - When `existing` is present: a show/hide toggle chip.
 *
 * The show/hide state is owned by the parent card (via `shown` / `onToggle`)
 * because the Traditional text itself renders outside this component, in the
 * card's metadata area.
 */
export function TraditionalButton({
  text,
  existing,
  onGenerated,
  shown,
  onToggle,
  locale,
}: {
  text: string;
  existing?: string;
  onGenerated: (traditionalText: string) => void;
  shown: boolean;
  onToggle: () => void;
  locale: UiLocale;
}) {
  if (existing) {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        title={shown ? t(locale, 'traditional.hide') : t(locale, 'traditional.show')}
        className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs transition ${
          shown
            ? 'border-cinnabar-border bg-cinnabar-light text-cinnabar'
            : 'border-border bg-transparent text-muted hover:border-border-hover hover:text-ink-secondary'
        }`}
      >
        繁
      </button>
    );
  }

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        const traditionalText = toTraditionalTaiwan(text);
        onGenerated(traditionalText);
      }}
      className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-cinnabar"
    >
      <Sparkles className="h-3 w-3" />
      {t(locale, 'traditional.generate')}
    </button>
  );
}
```

- [ ] **Step 2: Verify it compiles**

```bash
npm run compile
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/newtab/components/TraditionalButton.tsx
git commit -m "feat: add TraditionalButton component"
```

---

## Task 6: Wire `TraditionalButton` into `WordCard`

**Files:**
- Modify: `entrypoints/newtab/components/WordCard.tsx`

- [ ] **Step 1: Add the import and state**

In `entrypoints/newtab/components/WordCard.tsx`:

1. Add this import near the other component imports (after the `PinyinButton` import on line 13):

```tsx
import { TraditionalButton } from './TraditionalButton';
```

2. Inside the `WordCard` function body, after the `const [note, setNote] = useState(word.note);` line (around line 28), add:

```tsx
  const [showTraditional, setShowTraditional] = useState(false);
```

- [ ] **Step 2: Add the button to the header row**

In the same file, find the header row that contains `PinyinButton` (around lines 49-54):

```tsx
            <PinyinButton
              text={word.text}
              existing={word.pinyin}
              onGenerated={(pinyin) => onUpdate({ pinyin })}
              locale={locale}
            />
```

Add `TraditionalButton` immediately after the closing `/>` of `PinyinButton`, still inside the same `flex items-center gap-2` div:

```tsx
            <TraditionalButton
              text={word.text}
              existing={word.traditionalText}
              onGenerated={(traditionalText) => onUpdate({ traditionalText })}
              shown={showTraditional}
              onToggle={() => setShowTraditional((v) => !v)}
              locale={locale}
            />
```

- [ ] **Step 3: Render the Traditional text in the metadata band**

Find the metadata band that starts with `<div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">` (around line 56). Inside that div, after the `latestLabel` conditional block (after its closing `)}` around line 67), add a new conditional block:

```tsx
            {showTraditional && word.traditionalText && (
              <span className="text-xs italic text-cinnabar">
                {word.traditionalText}
              </span>
            )}
```

- [ ] **Step 4: Verify it compiles**

```bash
npm run compile
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/newtab/components/WordCard.tsx
git commit -m "feat: wire TraditionalButton into WordCard"
```

---

## Task 7: Wire `TraditionalButton` into `QuoteCard`

**Files:**
- Modify: `entrypoints/newtab/components/QuoteCard.tsx`

- [ ] **Step 1: Add the imports and state**

In `entrypoints/newtab/components/QuoteCard.tsx`:

1. The file currently imports only `useState` from react and `t` from i18n. Add the component import after the existing `import` lines (after line 3):

```tsx
import { TraditionalButton } from './TraditionalButton';
```

2. Inside the `QuoteCard` function body, after the `const [note, setNote] = useState(quote.note);` line (line 16), add:

```tsx
  const [showTraditional, setShowTraditional] = useState(false);
```

- [ ] **Step 2: Add the button to the metadata row**

Find the metadata row that starts with `<div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">` (around line 29). Inside that div, after the `quote.sourceUrl` anchor block (after its closing `)}` around line 44), add the button:

```tsx
        <TraditionalButton
          text={quote.text}
          existing={quote.traditionalText}
          onGenerated={(traditionalText) => onUpdate({ traditionalText })}
          shown={showTraditional}
          onToggle={() => setShowTraditional((v) => !v)}
          locale={locale}
        />
```

- [ ] **Step 3: Render the Traditional text beneath the blockquote**

Find the closing `</blockquote>` (around line 28). Immediately after it (before the metadata row `<div className="mt-3 ...">`), add:

```tsx
      {showTraditional && quote.traditionalText && (
        <p className="mt-2 pl-5 text-sm italic text-cinnabar">
          {quote.traditionalText}
        </p>
      )}
```

- [ ] **Step 4: Verify it compiles**

```bash
npm run compile
```

Expected: no errors.

- [ ] **Step 5: Run the full test suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/newtab/components/QuoteCard.tsx
git commit -m "feat: wire TraditionalButton into QuoteCard"
```

---

## Task 8: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full compile check**

```bash
npm run compile
```

Expected: no errors.

- [ ] **Step 2: Run the full test suite**

```bash
npm test
```

Expected: all tests pass, including the new `tests/traditional.test.ts` (6 tests) and the extended `tests/i18n.test.ts`.

- [ ] **Step 3: Verify there are no stray changes outside the plan**

```bash
git status --short
```

Expected: clean working tree (all changes committed across Tasks 1-7), or only pre-existing untracked/modified files unrelated to this feature.

This feature adds no manifest, background, or permissions changes, so the build + manifest inspection step is not required.
