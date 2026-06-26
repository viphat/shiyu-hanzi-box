# Cloze Input Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace how cloze blanks are authored — remove the dead saved-words suggestion engine and add two new input methods: manual brace-markup editing and AI-generated suggestions.

**Architecture:** Strip `suggestClozes` and the save-time auto-cloze path. Add a pure brace-markup parser (`parseClozeMarkup`/`seedMarkup`) for manual marking, and an AI flow (`buildClozeMessages` → `fetchClozeSuggestions` → `parseClozeSuggestions` → `suggestionsToCandidates`) that mirrors the existing word AI-insight architecture. The `Cloze` data model, FSRS scheduling, review UI, parked filter, and Markdown export are all unchanged.

**Tech Stack:** TypeScript, React (WXT browser extension), Vitest (+ happy-dom for component tests), Tailwind, OpenAI-compatible chat API.

## Global Constraints

- **No `Cloze` model change, no migration.** `Cloze` stays `{ id, start, end, hint?, wordId?, review? }`. New paths never set `wordId`.
- **i18n parity:** every new key must exist in BOTH `en` and `zh-CN` blocks of `lib/i18n.ts`.
- **No inline locale ternaries** in `entrypoints/` — `tests/i18n-source.test.ts` rejects any `locale === 'en' ?`. Always use `t(locale, key)`.
- **No new runtime dependencies.** Reuse the existing AI client, settings, and permission flow.
- **No new network access** beyond the AI provider the user already configures and grants host permission to.
- **AI never auto-commits.** Suggestions render as candidates the user accepts with one click.
- Match existing Tailwind class conventions (e.g. `rounded-sm border border-cinnabar-border bg-cinnabar-light`).
- Run the full suite with `npm test`; run a single file with `npx vitest run tests/<file>`.
- Commit after each task.

---

## File Structure

**Modified:**
- `lib/cloze.ts` — remove `suggestClozes` + helpers used only by it; add `parseClozeMarkup` + `seedMarkup`.
- `lib/capture.ts` — drop `autoCloze` option and `suggestClozes` call; 2-arg `saveQuote`.
- `lib/ai/client.ts` — add optional `maxTokens` to `postChatCompletion`; add `fetchClozeSuggestions`.
- `lib/i18n.ts` — add manual + AI keys (both locales); drop `cloze.noSuggestions`.
- `entrypoints/dashboard/App.tsx` — drop `savedWords={inbox.words}` from `<QuoteList>`.
- `entrypoints/dashboard/components/QuoteList.tsx` — drop `savedWords` prop + threading.
- `entrypoints/dashboard/components/QuoteCard.tsx` — drop `savedWords`; pass `onUpdate` to `ClozeEditor`.
- `entrypoints/dashboard/components/ClozeEditor.tsx` — remove saved-words suggest; add manual textarea (Phase 2) and AI panel (Phase 3).

**Created:**
- `lib/ai/cloze-prompt.ts` — `buildClozeMessages(quoteText)`.
- `lib/ai/cloze-parse.ts` — `parseClozeSuggestions`, `suggestionsToCandidates`, `ClozeSuggestion`, `ClozeCandidate`.
- `entrypoints/dashboard/hooks/useClozeSuggestions.ts` — AI suggestion hook.
- `tests/ai-cloze-prompt.test.ts`, `tests/ai-cloze-parse.test.ts`, `tests/ai-cloze-client.test.ts` — new test files.

**Test files modified:**
- `tests/cloze.test.ts`, `tests/capture.test.ts`, `tests/cloze-editor.test.tsx`, `tests/quote-list.test.tsx`, `tests/i18n.test.ts`, and `tests/capture-handler.test.ts` (verify no cloze assertions break).

---

# Phase 1 — Remove saved-words coupling

### Task 1: Remove `suggestClozes` and its dead helpers from `lib/cloze.ts`

**Files:**
- Modify: `lib/cloze.ts`
- Test: `tests/cloze.test.ts`

**Interfaces:**
- Produces: `lib/cloze.ts` keeps `clozeFromRange`, `clozesOverlap`, `normalizeClozes` (if present), `isParkedQuote`, `countParkedQuotes`, plus internal `hasMeaningfulChar`/`isWhitespace`/`isUnicodePunct` (still used by `clozeFromRange`). Removes `suggestClozes`, `normalizeWithMap`, `toHalfWidth`, `FULLWIDTH_OFFSET`, `NormalizedView`.

- [ ] **Step 1: Delete the `suggestClozes` tests first (Red baseline)**

Open `tests/cloze.test.ts` and delete every `describe`/`it` block that exercises `suggestClozes`. Remove `suggestClozes` from the import line at the top of the file (keep the other imports). Also remove any `WordEntry` import that was only used to build saved-word fixtures for those tests.

- [ ] **Step 2: Run the cloze tests to confirm they still pass without the suggest cases**

Run: `npx vitest run tests/cloze.test.ts`
Expected: PASS (remaining `clozeFromRange`, `clozesOverlap`, `isParkedQuote`, `countParkedQuotes` tests).

- [ ] **Step 3: Remove `suggestClozes` and its private-only helpers from `lib/cloze.ts`**

In `lib/cloze.ts`:
- Delete the `suggestClozes` function (lines defining it).
- Delete `normalizeWithMap`, `toHalfWidth`, `FULLWIDTH_OFFSET`, and the `NormalizedView` interface — these are used ONLY by `suggestClozes`.
- KEEP `isWhitespace`, `isUnicodePunct`, and `hasMeaningfulChar` — `clozeFromRange` still calls `hasMeaningfulChar`.
- Fix the import block. After removal, `normalizeText` (from `./normalize`) and the `WordEntry` type are no longer used — remove them. Keep `makeId` (used by `clozeFromRange`) and the `Cloze`/`QuoteEntry` type imports.

The resulting import block should be:

```ts
import { makeId } from './id';
import type { Cloze, QuoteEntry } from './types';
```

- [ ] **Step 4: Typecheck and run the cloze tests**

Run: `npx tsc --noEmit && npx vitest run tests/cloze.test.ts`
Expected: PASS, no unused-import or type errors.

- [ ] **Step 5: Commit**

```bash
git add lib/cloze.ts tests/cloze.test.ts
git commit -m "refactor(cloze): remove dead suggestClozes saved-words engine"
```

---

### Task 2: Drop `autoCloze` from `saveQuote`

**Files:**
- Modify: `lib/capture.ts`
- Test: `tests/capture.test.ts`, `tests/capture-handler.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `saveQuote(text: string, src: SourceInfo): Promise<QuoteEntry | null>` — 2-arg signature, always saves `clozes: []`.

- [ ] **Step 1: Update/add the failing capture test**

In `tests/capture.test.ts`, find the `saveQuote` describe block. Replace any test asserting auto-clozing with one that asserts parked save. Add (or adjust) this test:

```ts
it('saves a quote parked with no clozes', async () => {
  await saveWord('刚需', { ...src, capturedAt: 500 });
  const quote = await saveQuote('满足人们的刚需才能持续花钱', src);
  expect(quote).not.toBeNull();
  const inbox = await getInbox();
  expect(inbox.quotes).toHaveLength(1);
  expect(inbox.quotes[0].clozes).toEqual([]);
});
```

Delete any existing test that passes `{ autoCloze: ... }` or asserts a non-empty `clozes` array from `saveQuote`.

- [ ] **Step 2: Run the capture test to verify it fails**

Run: `npx vitest run tests/capture.test.ts`
Expected: FAIL — current `saveQuote` auto-clozes `刚需`, so `clozes` is not `[]` (or the `autoCloze` option is referenced).

- [ ] **Step 3: Rewrite `saveQuote` to always park**

In `lib/capture.ts`, remove the `import { suggestClozes } from './cloze';` line and remove the now-unused `WordEntry` import only if nothing else uses it (`saveWord` still uses `WordEntry` — keep it). Replace the `saveQuote` signature and body:

```ts
export async function saveQuote(
  text: string,
  src: SourceInfo,
): Promise<QuoteEntry | null> {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  const now = src.capturedAt;
  let result: QuoteEntry | null = null;
  await mutateInbox((inbox) => {
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
      clozes: [],
    };
    result = quote;
    return { ...inbox, quotes: [quote, ...inbox.quotes] };
  });
  return result;
}
```

- [ ] **Step 4: Run the capture test to verify it passes**

Run: `npx vitest run tests/capture.test.ts`
Expected: PASS.

- [ ] **Step 5: Verify the capture-handler tests still pass**

The two `saveQuote` callers in `entrypoints/background/capture-handler.ts` already use the 2-arg form, so no source change is needed there.

Run: `npx vitest run tests/capture-handler.test.ts`
Expected: PASS. If a test asserts clozes on a saved quote, update it to expect `clozes: []`.

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: PASS.

```bash
git add lib/capture.ts tests/capture.test.ts tests/capture-handler.test.ts
git commit -m "refactor(capture): saveQuote always parks (no auto-cloze)"
```

---

### Task 3: Remove the `savedWords` prop chain and the saved-words suggest UI

**Files:**
- Modify: `entrypoints/dashboard/App.tsx:299-305`
- Modify: `entrypoints/dashboard/components/QuoteList.tsx`
- Modify: `entrypoints/dashboard/components/QuoteCard.tsx`
- Modify: `entrypoints/dashboard/components/ClozeEditor.tsx`
- Modify: `lib/i18n.ts` (drop `cloze.noSuggestions` in both locales)
- Test: `tests/cloze-editor.test.tsx`, `tests/quote-list.test.tsx`

**Interfaces:**
- Produces:
  - `QuoteList` props lose `savedWords`.
  - `QuoteCard` props lose `savedWords`.
  - `ClozeEditor` props: `{ quote: QuoteEntry; onChange: (clozes: Cloze[]) => void; locale: UiLocale; quoteTextRef?: RefObject<HTMLElement | null> }` — `savedWords` removed.

- [ ] **Step 1: Update the failing component tests first**

In `tests/cloze-editor.test.tsx`:
- Delete the import of `WordEntry` and the `makeWord` helper if it is used only for `savedWords`.
- Delete every `it(...)` that exercises the "建议填空" / suggest-from-saved-words behavior.
- Remove the `savedWords={...}` prop from every `<ClozeEditor />` render in the test.

In `tests/quote-list.test.tsx`:
- Remove `savedWords={...}` from every `<QuoteList />` render and drop any saved-word fixtures only used for that prop.

- [ ] **Step 2: Run both component tests to confirm they fail to compile/render**

Run: `npx vitest run tests/cloze-editor.test.tsx tests/quote-list.test.tsx`
Expected: FAIL (TypeScript still requires `savedWords`, or removed suggest tests reference deleted behavior).

- [ ] **Step 3: Remove `savedWords` from `App.tsx`**

In `entrypoints/dashboard/App.tsx`, delete the `savedWords={inbox.words}` line inside the `<QuoteList>` element (around line 304).

- [ ] **Step 4: Remove `savedWords` from `QuoteList.tsx`**

In `entrypoints/dashboard/components/QuoteList.tsx`:
- Remove `savedWords,` from the destructured props.
- Remove `savedWords: WordEntry[];` from the props type.
- Remove the `savedWords={savedWords}` prop passed to `<QuoteCard>`.
- Remove the now-unused `WordEntry` import.

- [ ] **Step 5: Remove `savedWords` from `QuoteCard.tsx` and pass `onUpdate` to `ClozeEditor`**

In `entrypoints/dashboard/components/QuoteCard.tsx`:
- Remove `savedWords,` from the destructured props and `savedWords: WordEntry[];` from the props type.
- Remove the now-unused `WordEntry` import.
- Update the `<ClozeEditor>` render to drop `savedWords` and add `onUpdate`:

```tsx
<ClozeEditor
  quote={quote}
  onChange={(clozes: Cloze[]) => onUpdate({ clozes })}
  onUpdate={onUpdate}
  locale={locale}
  quoteTextRef={quoteTextRef}
/>
```

(`onUpdate` is the existing `(patch: Partial<QuoteEntry>) => void` prop already on `QuoteCard`; it is used by the manual-input path in Phase 2 and is harmless now.)

- [ ] **Step 6: Strip the saved-words suggest UI from `ClozeEditor.tsx`**

In `entrypoints/dashboard/components/ClozeEditor.tsx`:
- Change the import to drop `suggestClozes` and `WordEntry`:

```ts
import { type RefObject, useState } from 'react';
import { clozeFromRange } from '@/lib/cloze';
import { resolveSelectionOffsets } from '@/lib/cloze-selection';
import { t } from '@/lib/i18n';
import type { Cloze, QuoteEntry, UiLocale } from '@/lib/types';
```

- Update the props interface and signature:

```ts
interface ClozeEditorProps {
  quote: QuoteEntry;
  onChange: (clozes: Cloze[]) => void;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  locale: UiLocale;
  quoteTextRef?: RefObject<HTMLElement | null>;
}

export function ClozeEditor({ quote, onChange, onUpdate, locale, quoteTextRef }: ClozeEditorProps) {
  const clozes = quote.clozes ?? [];
```

- Delete the `const [suggestions, setSuggestions] = useState<Cloze[] | null>(null);` line.
- Delete `handleSuggest`, `acceptSuggestion`, and the entire "Suggestions panel" JSX block (the `{suggestions !== null && (...)}` section).
- Delete the "建议填空" (`cloze.suggestBlanks`) button from the actions row, leaving only the drag-select "Add blank" button.
- Keep `removeCloze`, `changeHint`, `handleAddBlank`, the chips, and `ClozeChip`.

> `onUpdate` and `clozesOverlap` are reintroduced for use in Phase 2/3; if your linter flags `onUpdate` as unused at this point, that's fine — Phase 2 wires it. To keep this task's build clean, you may leave `onUpdate` in the signature unused (TypeScript does not error on unused destructured props).

- [ ] **Step 7: Drop the now-unused `cloze.noSuggestions` i18n key**

First confirm nothing else references it:

Run: `grep -rn "cloze.noSuggestions" entrypoints lib tests`
Expected: no matches outside `lib/i18n.ts`.

In `lib/i18n.ts`, delete `'cloze.noSuggestions': 'No new suggestions',` (en, ~line 137) and `'cloze.noSuggestions': '没有新建议',` (zh-CN, ~line 282).

- [ ] **Step 8: Run the component + i18n tests**

Run: `npx vitest run tests/cloze-editor.test.tsx tests/quote-list.test.tsx tests/i18n.test.ts tests/i18n-source.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add entrypoints lib/i18n.ts tests/cloze-editor.test.tsx tests/quote-list.test.tsx
git commit -m "refactor(cloze): drop savedWords prop chain and dead suggest UI"
```

---

# Phase 2 — Manual marker input

### Task 4: `parseClozeMarkup` + `seedMarkup`

**Files:**
- Modify: `lib/cloze.ts`
- Test: `tests/cloze.test.ts`

**Interfaces:**
- Consumes: `makeId` from `./id`; `Cloze` type; `clozesOverlap` (already exported from this file).
- Produces:

```ts
export type ClozeMarkupResult =
  | { ok: true; text: string; clozes: Cloze[] }
  | { ok: false; reason: 'unbalanced' | 'empty-span' | 'overlap' | 'nested' };

export function parseClozeMarkup(markup: string): ClozeMarkupResult;
export function seedMarkup(text: string, clozes: Cloze[]): string;
```

- [ ] **Step 1: Write the failing tests**

Append to `tests/cloze.test.ts` (add `parseClozeMarkup`, `seedMarkup` to the existing `import { ... } from '../lib/cloze'`):

```ts
describe('parseClozeMarkup', () => {
  it('parses a single brace pair into one cloze with de-braced offsets', () => {
    const result = parseClozeMarkup('满足人们的{刚需}，持续花钱');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('满足人们的刚需，持续花钱');
    expect(result.clozes).toHaveLength(1);
    expect(result.text.slice(result.clozes[0].start, result.clozes[0].end)).toBe('刚需');
    expect(result.clozes[0].start).toBe(5);
    expect(result.clozes[0].end).toBe(7);
  });

  it('parses multiple brace pairs in document order with correct offsets', () => {
    const result = parseClozeMarkup('{学}而时{习}之');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('学而时习之');
    expect(result.clozes.map((c) => [c.start, c.end])).toEqual([[0, 1], [3, 4]]);
  });

  it('rejects unbalanced braces', () => {
    expect(parseClozeMarkup('满足{刚需')).toEqual({ ok: false, reason: 'unbalanced' });
    expect(parseClozeMarkup('满足刚需}')).toEqual({ ok: false, reason: 'unbalanced' });
  });

  it('rejects nested braces', () => {
    expect(parseClozeMarkup('{a{b}c}')).toEqual({ ok: false, reason: 'nested' });
  });

  it('rejects an empty span', () => {
    expect(parseClozeMarkup('满足{}刚需')).toEqual({ ok: false, reason: 'empty-span' });
  });

  it('treats escaped braces as literal characters', () => {
    const result = parseClozeMarkup('用法 \\{ 与 \\}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe('用法 { 与 }');
    expect(result.clozes).toHaveLength(0);
  });

  it('leaves wordId unset and hint unset on parsed clozes', () => {
    const result = parseClozeMarkup('{刚需}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.clozes[0].wordId).toBeUndefined();
    expect(result.clozes[0].hint).toBeUndefined();
  });
});

describe('seedMarkup', () => {
  it('wraps existing cloze spans in braces', () => {
    const text = '满足人们的刚需，持续花钱';
    const clozes = [{ id: 'c1', start: 5, end: 7 }];
    expect(seedMarkup(text, clozes)).toBe('满足人们的{刚需}，持续花钱');
  });

  it('round-trips through parseClozeMarkup', () => {
    const text = '学而时习之，不亦说乎';
    const clozes = [
      { id: 'a', start: 0, end: 1 },
      { id: 'b', start: 3, end: 4 },
    ];
    const result = parseClozeMarkup(seedMarkup(text, clozes));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.text).toBe(text);
    expect(result.clozes.map((c) => [c.start, c.end])).toEqual([[0, 1], [3, 4]]);
  });

  it('escapes literal braces already present in the text', () => {
    const text = '集合 {x} 表示';
    expect(seedMarkup(text, [])).toBe('集合 \\{x\\} 表示');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cloze.test.ts`
Expected: FAIL with "parseClozeMarkup is not a function" / "seedMarkup is not a function".

- [ ] **Step 3: Implement `parseClozeMarkup` and `seedMarkup`**

Append to `lib/cloze.ts` (the file already exports `clozesOverlap` used by the overlap guard):

```ts
export type ClozeMarkupResult =
  | { ok: true; text: string; clozes: Cloze[] }
  | { ok: false; reason: 'unbalanced' | 'empty-span' | 'overlap' | 'nested' };

/**
 * Parse brace-delimited cloze markup. `{答案}` wraps the answer span; the
 * returned `text` is the markup with braces stripped, and each cloze's
 * [start, end) indexes into that clean text. Use `\{` / `\}` for literal braces.
 */
export function parseClozeMarkup(markup: string): ClozeMarkupResult {
  let text = '';
  const clozes: Cloze[] = [];
  let spanStart: number | null = null;
  let i = 0;

  while (i < markup.length) {
    const ch = markup[i];

    if (ch === '\\' && (markup[i + 1] === '{' || markup[i + 1] === '}')) {
      text += markup[i + 1];
      i += 2;
      continue;
    }
    if (ch === '{') {
      if (spanStart !== null) return { ok: false, reason: 'nested' };
      spanStart = text.length;
      i += 1;
      continue;
    }
    if (ch === '}') {
      if (spanStart === null) return { ok: false, reason: 'unbalanced' };
      if (text.length === spanStart) return { ok: false, reason: 'empty-span' };
      clozes.push({ id: makeId(), start: spanStart, end: text.length });
      spanStart = null;
      i += 1;
      continue;
    }
    text += ch;
    i += 1;
  }

  if (spanStart !== null) return { ok: false, reason: 'unbalanced' };
  // Pairs are disjoint by construction, but guard anyway per the spec.
  if (clozesOverlap(clozes)) return { ok: false, reason: 'overlap' };

  return { ok: true, text, clozes };
}

function escapeBraces(text: string): string {
  return text.replace(/[{}]/g, (ch) => `\\${ch}`);
}

/**
 * Render `text` with `clozes` re-expressed as brace markup, so the manual
 * editor can seed an editable, round-trippable copy. Literal braces in the
 * text are escaped.
 */
export function seedMarkup(text: string, clozes: Cloze[]): string {
  const sorted = [...clozes].sort((a, b) => a.start - b.start);
  let out = '';
  let pos = 0;
  for (const c of sorted) {
    out += escapeBraces(text.slice(pos, c.start));
    out += `{${escapeBraces(text.slice(c.start, c.end))}}`;
    pos = c.end;
  }
  out += escapeBraces(text.slice(pos));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cloze.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/cloze.ts tests/cloze.test.ts
git commit -m "feat(cloze): add brace-markup parser and seeder for manual input"
```

---

### Task 5: Manual "手动填空" textarea in `ClozeEditor`

**Files:**
- Modify: `entrypoints/dashboard/components/ClozeEditor.tsx`
- Modify: `lib/i18n.ts`
- Test: `tests/cloze-editor.test.tsx`

**Interfaces:**
- Consumes: `parseClozeMarkup`, `seedMarkup` from `@/lib/cloze`; `onUpdate` prop (added in Task 3).
- Produces: ClozeEditor renders a button (text `cloze.markBlanks`) that toggles a `<textarea>` plus an Apply button (`cloze.applyMarks`); on apply it commits parsed clozes (and edited text) and shows `cloze.markupError` on parse failure.

- [ ] **Step 1: Add the i18n keys (both locales)**

In `lib/i18n.ts`, in the `en` cloze region add:

```ts
    'cloze.markBlanks': 'Mark blanks',
    'cloze.applyMarks': 'Apply',
    'cloze.markupHelp': 'Wrap each answer in braces, e.g. 满足人们的{刚需}.',
    'cloze.markupError': "Couldn't read your blanks — check the { } pairs.",
```

In the `zh-CN` cloze region add:

```ts
    'cloze.markBlanks': '手动填空',
    'cloze.applyMarks': '应用',
    'cloze.markupHelp': '用大括号包住每个答案，例如 满足人们的{刚需}。',
    'cloze.markupError': '无法识别填空——请检查 { } 是否成对。',
```

- [ ] **Step 2: Write the failing component test**

Add to `tests/cloze-editor.test.tsx`. The file already mounts components via `createRoot` and uses `act`; follow the existing helpers (`makeQuote`, the render harness). Add:

```ts
it('manual apply commits parsed clozes from brace markup', async () => {
  const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
  const onChange = vi.fn();
  const onUpdate = vi.fn();
  renderEditor({ quote, onChange, onUpdate });

  // Open the manual editor
  clickButtonByText('手动填空');
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  setTextareaValue(textarea, '满足人们的{刚需}');
  clickButtonByText('应用');

  // text unchanged -> onChange(clozes) called, onUpdate not called
  expect(onChange).toHaveBeenCalledTimes(1);
  const committed = onChange.mock.calls[0][0];
  expect(committed).toHaveLength(1);
  expect(quote.text.slice(committed[0].start, committed[0].end)).toBe('刚需');
  expect(onUpdate).not.toHaveBeenCalled();
});

it('manual apply persists edited text via onUpdate when the sentence changes', async () => {
  const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
  const onChange = vi.fn();
  const onUpdate = vi.fn();
  renderEditor({ quote, onChange, onUpdate });

  clickButtonByText('手动填空');
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  setTextareaValue(textarea, '满足大众的{刚需}');
  clickButtonByText('应用');

  expect(onUpdate).toHaveBeenCalledTimes(1);
  const patch = onUpdate.mock.calls[0][0];
  expect(patch.text).toBe('满足大众的刚需');
  expect(patch.clozes).toHaveLength(1);
});

it('manual apply shows an inline error on malformed markup and does not mutate', async () => {
  const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
  const onChange = vi.fn();
  const onUpdate = vi.fn();
  renderEditor({ quote, onChange, onUpdate });

  clickButtonByText('手动填空');
  const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
  setTextareaValue(textarea, '满足{刚需');
  clickButtonByText('应用');

  expect(onChange).not.toHaveBeenCalled();
  expect(onUpdate).not.toHaveBeenCalled();
  expect(container.textContent).toContain('无法识别填空');
});
```

> If `tests/cloze-editor.test.tsx` does not already have `renderEditor`/`clickButtonByText`/`setTextareaValue`/`container` helpers, add small local helpers mirroring the existing mount pattern in that file: a `container` div appended to `document.body`, `createRoot(container).render(...)` inside `act`, a `clickButtonByText(label)` that finds a `<button>` whose `textContent` matches and dispatches a click in `act`, and a `setTextareaValue` that sets `.value` and dispatches an `input` event in `act`. Reuse whatever the file already defines.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/cloze-editor.test.tsx`
Expected: FAIL — no "手动填空" button yet.

- [ ] **Step 4: Implement the manual textarea in `ClozeEditor`**

In `entrypoints/dashboard/components/ClozeEditor.tsx`:
- Update the cloze import to include the markup functions:

```ts
import { clozeFromRange, parseClozeMarkup, seedMarkup } from '@/lib/cloze';
```

- Add manual-input state and handlers inside the component (near the top, after `const clozes = quote.clozes ?? [];`):

```ts
const [showMarkup, setShowMarkup] = useState(false);
const [markup, setMarkup] = useState('');
const [markupError, setMarkupError] = useState('');

function openMarkup() {
  setMarkup(seedMarkup(quote.text, clozes));
  setMarkupError('');
  setShowMarkup(true);
}

function applyMarkup() {
  const result = parseClozeMarkup(markup);
  if (!result.ok) {
    setMarkupError(t(locale, 'cloze.markupError'));
    return;
  }
  if (result.text === quote.text) {
    onChange(result.clozes);
  } else {
    onUpdate({ text: result.text, clozes: result.clozes });
  }
  setMarkupError('');
  setShowMarkup(false);
}
```

- Add the manual UI block and a "手动填空" toggle button. Place the panel above the actions row and add the button into the actions `<div className="flex flex-wrap gap-2">`:

```tsx
{showMarkup && (
  <div className="space-y-1 rounded-sm border border-border bg-paper-input p-2">
    <textarea
      value={markup}
      onChange={(e) => setMarkup(e.target.value)}
      rows={3}
      className="w-full resize-none rounded-sm border border-border bg-paper-light p-2 text-sm text-ink outline-none focus:border-cinnabar-fade"
    />
    <p className="text-[11px] text-muted">{t(locale, 'cloze.markupHelp')}</p>
    {markupError && <p className="text-[11px] text-cinnabar">{markupError}</p>}
    <button
      type="button"
      onClick={applyMarkup}
      className="rounded-sm border border-cinnabar-border bg-cinnabar px-2 py-0.5 text-xs text-white transition hover:bg-cinnabar/80"
    >
      {t(locale, 'cloze.applyMarks')}
    </button>
  </div>
)}
```

Actions-row button (add alongside the existing "Add blank" button):

```tsx
<button
  type="button"
  onClick={showMarkup ? () => setShowMarkup(false) : openMarkup}
  className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-xs text-cinnabar transition hover:bg-cinnabar hover:text-white"
>
  {t(locale, 'cloze.markBlanks')}
</button>
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/cloze-editor.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/dashboard/components/ClozeEditor.tsx lib/i18n.ts tests/cloze-editor.test.tsx
git commit -m "feat(cloze): manual brace-markup editor with apply + inline errors"
```

---

# Phase 3 — AI suggestions

### Task 6: AI cloze prompt builder

**Files:**
- Create: `lib/ai/cloze-prompt.ts`
- Test: `tests/ai-cloze-prompt.test.ts`

**Interfaces:**
- Consumes: `AiMessage` from `./prompt`.
- Produces: `export function buildClozeMessages(quoteText: string): AiMessage[]`.

- [ ] **Step 1: Write the failing test**

Create `tests/ai-cloze-prompt.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildClozeMessages } from '../lib/ai/cloze-prompt';

describe('buildClozeMessages', () => {
  it('returns a system + user message with the sentence embedded', () => {
    const messages = buildClozeMessages('满足人们的刚需');
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[0].content).toContain('blanks');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('满足人们的刚需');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ai-cloze-prompt.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ai/cloze-prompt.ts`**

```ts
import type { AiMessage } from './prompt';

const SYSTEM_PROMPT = `You help build Chinese fill-in-the-blank (cloze) flashcards. Given one Chinese sentence, choose 1-5 spans most worth testing as cloze deletions — key vocabulary, idioms, or collocations, never function words or punctuation.

Return valid JSON only, no markdown, in this shape:
{"blanks":[{"answer":"刚需","reason":"key vocabulary"}]}

Each "answer" MUST be an exact, verbatim substring of the sentence. "reason" is a short English label. Respond with JSON only.`;

export function buildClozeMessages(quoteText: string): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Sentence: ${quoteText}` },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/ai-cloze-prompt.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/cloze-prompt.ts tests/ai-cloze-prompt.test.ts
git commit -m "feat(ai): add cloze suggestion prompt builder"
```

---

### Task 7: AI response parsing + offset mapping

**Files:**
- Create: `lib/ai/cloze-parse.ts`
- Test: `tests/ai-cloze-parse.test.ts`

**Interfaces:**
- Consumes: `Cloze` type; `clozesOverlap` from `../cloze`; `makeId` from `../id`.
- Produces:

```ts
export interface ClozeSuggestion { answer: string; reason?: string; }
export interface ClozeCandidate { cloze: Cloze; reason?: string; }
export function parseClozeSuggestions(content: string):
  | { ok: true; suggestions: ClozeSuggestion[] }
  | { ok: false; reason: string };
export function suggestionsToCandidates(
  text: string,
  suggestions: ClozeSuggestion[],
  existing: Cloze[],
): ClozeCandidate[];
```

- [ ] **Step 1: Write the failing tests**

Create `tests/ai-cloze-parse.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { parseClozeSuggestions, suggestionsToCandidates } from '../lib/ai/cloze-parse';
import type { Cloze } from '../lib/types';

describe('parseClozeSuggestions', () => {
  it('parses a valid blanks array', () => {
    const result = parseClozeSuggestions('{"blanks":[{"answer":"刚需","reason":"key"}]}');
    expect(result).toEqual({ ok: true, suggestions: [{ answer: '刚需', reason: 'key' }] });
  });

  it('rejects malformed JSON', () => {
    const result = parseClozeSuggestions('not json');
    expect(result.ok).toBe(false);
  });

  it('rejects a non-object / missing blanks array', () => {
    expect(parseClozeSuggestions('[]').ok).toBe(false);
    expect(parseClozeSuggestions('{"foo":1}').ok).toBe(false);
  });

  it('drops entries without a non-empty string answer', () => {
    const result = parseClozeSuggestions('{"blanks":[{"answer":""},{"reason":"x"},{"answer":"刚需"}]}');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.suggestions).toEqual([{ answer: '刚需', reason: undefined }]);
  });
});

describe('suggestionsToCandidates', () => {
  const text = '满足人们的刚需才能持续满足';

  it('maps an exact substring to offsets', () => {
    const out = suggestionsToCandidates(text, [{ answer: '刚需', reason: 'k' }], []);
    expect(out).toHaveLength(1);
    expect(text.slice(out[0].cloze.start, out[0].cloze.end)).toBe('刚需');
    expect(out[0].reason).toBe('k');
  });

  it('ignores answers that are not a substring', () => {
    const out = suggestionsToCandidates(text, [{ answer: '股票' }], []);
    expect(out).toEqual([]);
  });

  it('picks the first occurrence not already covered', () => {
    // '满足' occurs at index 0 and again later; an existing cloze covers index 0.
    const existing: Cloze[] = [{ id: 'e', start: 0, end: 2 }];
    const out = suggestionsToCandidates(text, [{ answer: '满足' }], existing);
    expect(out).toHaveLength(1);
    expect(out[0].cloze.start).toBeGreaterThan(0);
    expect(text.slice(out[0].cloze.start, out[0].cloze.end)).toBe('满足');
  });

  it('drops a candidate whose only occurrences are all covered', () => {
    const existing: Cloze[] = [{ id: 'e', start: 5, end: 7 }]; // covers 刚需
    const out = suggestionsToCandidates(text, [{ answer: '刚需' }], existing);
    expect(out).toEqual([]);
  });

  it('drops overlapping candidates, preferring the longer span', () => {
    const out = suggestionsToCandidates('满足人们的刚需', [
      { answer: '刚' },
      { answer: '刚需' },
    ], []);
    expect(out).toHaveLength(1);
    expect(out[0].cloze.end - out[0].cloze.start).toBe(2);
  });

  it('returns candidates in document order', () => {
    const out = suggestionsToCandidates('满足人们的刚需', [
      { answer: '刚需' },
      { answer: '满足' },
    ], []);
    expect(out.map((c) => c.cloze.start)).toEqual([0, 5]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/ai-cloze-parse.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `lib/ai/cloze-parse.ts`**

```ts
import { clozesOverlap } from '../cloze';
import { makeId } from '../id';
import type { Cloze } from '../types';

export interface ClozeSuggestion {
  answer: string;
  reason?: string;
}

export interface ClozeCandidate {
  cloze: Cloze;
  reason?: string;
}

export function parseClozeSuggestions(
  content: string,
): { ok: true; suggestions: ClozeSuggestion[] } | { ok: false; reason: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { ok: false, reason: 'Response is not valid JSON.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'Response is not a JSON object.' };
  }
  const blanks = (parsed as Record<string, unknown>).blanks;
  if (!Array.isArray(blanks)) {
    return { ok: false, reason: 'Response schema mismatch: missing blanks array.' };
  }

  const suggestions: ClozeSuggestion[] = [];
  for (const item of blanks) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    const answer = rec.answer;
    if (typeof answer !== 'string' || answer.trim() === '') continue;
    const reason = typeof rec.reason === 'string' ? rec.reason : undefined;
    suggestions.push({ answer, reason });
  }
  return { ok: true, suggestions };
}

function locateUncovered(
  text: string,
  answer: string,
  covered: Cloze[],
): { start: number; end: number } | null {
  let from = 0;
  while (from <= text.length - answer.length) {
    const idx = text.indexOf(answer, from);
    if (idx === -1) return null;
    const end = idx + answer.length;
    const overlaps = covered.some((c) => idx < c.end && end > c.start);
    if (!overlaps) return { start: idx, end };
    from = idx + 1;
  }
  return null;
}

/**
 * Map AI answer strings to non-overlapping cloze candidates against `text`,
 * skipping spans already covered by `existing`. Longer answers win overlap
 * contests; results are returned in document order. Carries `reason` through.
 */
export function suggestionsToCandidates(
  text: string,
  suggestions: ClozeSuggestion[],
  existing: Cloze[],
): ClozeCandidate[] {
  const accepted: Cloze[] = [...existing];
  const out: ClozeCandidate[] = [];

  const ordered = [...suggestions].sort((a, b) => b.answer.length - a.answer.length);
  for (const s of ordered) {
    const span = locateUncovered(text, s.answer, accepted);
    if (!span) continue;
    const cloze: Cloze = { id: makeId(), start: span.start, end: span.end };
    if (clozesOverlap([...accepted, cloze])) continue;
    accepted.push(cloze);
    out.push({ cloze, reason: s.reason });
  }

  return out.sort((a, b) => a.cloze.start - b.cloze.start);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/ai-cloze-parse.test.ts && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/ai/cloze-parse.ts tests/ai-cloze-parse.test.ts
git commit -m "feat(ai): parse cloze suggestions and map answers to candidates"
```

---

### Task 8: `fetchClozeSuggestions` client call

**Files:**
- Modify: `lib/ai/client.ts`
- Test: `tests/ai-cloze-client.test.ts`

**Interfaces:**
- Consumes: `buildClozeMessages` from `./cloze-prompt`; `parseClozeSuggestions` + `ClozeSuggestion` from `./cloze-parse`; existing private `postChatCompletion`.
- Produces:

```ts
export async function fetchClozeSuggestions(params: {
  baseUrl: string; apiKey: string; model: string; provider: AiProvider; quoteText: string;
}): Promise<
  | { ok: true; suggestions: ClozeSuggestion[] }
  | { ok: false; reason: string }
>;
```

- [ ] **Step 1: Write the failing test**

Create `tests/ai-cloze-client.test.ts` (mirror the fetch-mock pattern from `tests/ai-client.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchClozeSuggestions } from '../lib/ai/client';

const VALID_BODY = JSON.stringify({ blanks: [{ answer: '刚需', reason: 'key' }] });
const VALID_COMPLETION = {
  ok: true as const,
  status: 200,
  json: async () => ({ choices: [{ message: { content: VALID_BODY } }] }),
} as unknown as Response;

describe('fetchClozeSuggestions', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => { fetchSpy = vi.spyOn(globalThis, 'fetch'); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('posts to /chat/completions with json_object and returns parsed suggestions', async () => {
    fetchSpy.mockResolvedValue(VALID_COMPLETION);
    const result = await fetchClozeSuggestions({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk-test',
      model: 'deepseek-chat',
      provider: 'deepseek',
      quoteText: '满足人们的刚需',
    });
    expect(result).toEqual({ ok: true, suggestions: [{ answer: '刚需', reason: 'key' }] });
    const [url, init] = fetchSpy.mock.calls[0];
    expect(String(url)).toBe('https://api.deepseek.com/chat/completions');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('maps HTTP errors via the existing classifier', async () => {
    fetchSpy.mockResolvedValue({ ok: false, status: 401, json: async () => ({}) } as unknown as Response);
    const result = await fetchClozeSuggestions({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'bad',
      model: 'deepseek-chat',
      provider: 'deepseek',
      quoteText: '你好',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('API key rejected');
  });

  it('returns a parse error when the body is not valid JSON', async () => {
    fetchSpy.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: 'oops' } }] }),
    } as unknown as Response);
    const result = await fetchClozeSuggestions({
      baseUrl: 'https://api.deepseek.com',
      apiKey: 'sk', model: 'deepseek-chat', provider: 'deepseek', quoteText: '你好',
    });
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/ai-cloze-client.test.ts`
Expected: FAIL — `fetchClozeSuggestions` is not exported.

- [ ] **Step 3: Add `maxTokens` to `postChatCompletion` and implement `fetchClozeSuggestions`**

In `lib/ai/client.ts`:
- Add the imports at the top:

```ts
import { buildClozeMessages } from './cloze-prompt';
import { parseClozeSuggestions, type ClozeSuggestion } from './cloze-parse';
```

- Add `maxTokens?: number` to the `postChatCompletion` params and use it (default 1200, preserving existing behavior):

```ts
async function postChatCompletion(
  params: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: AiMessage[];
    provider: AiProvider;
    maxTokens?: number;
  },
): Promise<
```

and in the request body change `max_tokens: 1200,` to:

```ts
      max_tokens: params.maxTokens ?? 1200,
```

- Add the new exported function (place it after `fetchAiInsight`):

```ts
export async function fetchClozeSuggestions(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  quoteText: string;
}): Promise<
  | { ok: true; suggestions: ClozeSuggestion[] }
  | { ok: false; reason: string }
> {
  try {
    const result = await postChatCompletion({
      baseUrl: params.baseUrl,
      apiKey: params.apiKey,
      model: params.model,
      provider: params.provider,
      messages: buildClozeMessages(params.quoteText),
      maxTokens: 400,
    });
    if (!result.ok) return result;
    return parseClozeSuggestions(result.content);
  } catch {
    return { ok: false, reason: 'Provider unreachable; retry.' };
  }
}
```

- [ ] **Step 4: Run the new test and the existing AI client test**

Run: `npx vitest run tests/ai-cloze-client.test.ts tests/ai-client.test.ts && npx tsc --noEmit`
Expected: PASS (the `max_tokens: 1200` default keeps `fetchAiInsight` behavior unchanged).

- [ ] **Step 5: Commit**

```bash
git add lib/ai/client.ts tests/ai-cloze-client.test.ts
git commit -m "feat(ai): add fetchClozeSuggestions client call"
```

---

### Task 9: `useClozeSuggestions` hook

**Files:**
- Create: `entrypoints/dashboard/hooks/useClozeSuggestions.ts`
- Test: covered indirectly via Task 10's component test (the hook has no standalone test file; it is thin glue mirroring `useAiInsight`).

**Interfaces:**
- Consumes: `fetchClozeSuggestions` from `@/lib/ai/client`; `suggestionsToCandidates` + `ClozeCandidate` from `@/lib/ai/cloze-parse`; `getAiSettings` from `@/lib/ai/settings`; `requestAiSettingsPermission` from `@/lib/ai/permissions`; `AiSettings`, `QuoteEntry` types.
- Produces:

```ts
export type ClozeAiState = 'checking' | 'idle' | 'loading' | 'disabled' | 'error';
export function useClozeSuggestions(quote: QuoteEntry): {
  state: ClozeAiState;
  error: string;
  candidates: ClozeCandidate[] | null;
  requestSuggestions: () => Promise<void>;
  dismissCandidate: (id: string) => void;
};
```

- [ ] **Step 1: Implement the hook**

Create `entrypoints/dashboard/hooks/useClozeSuggestions.ts`:

```ts
import { useEffect, useState } from 'react';
import { fetchClozeSuggestions } from '@/lib/ai/client';
import { suggestionsToCandidates, type ClozeCandidate } from '@/lib/ai/cloze-parse';
import { requestAiSettingsPermission } from '@/lib/ai/permissions';
import { getAiSettings } from '@/lib/ai/settings';
import type { AiSettings, QuoteEntry } from '@/lib/types';

export type ClozeAiState = 'checking' | 'idle' | 'loading' | 'disabled' | 'error';

function isConfigured(settings: AiSettings): boolean {
  return (
    settings.enabled &&
    settings.apiKey.trim() !== '' &&
    settings.baseUrl.trim() !== '' &&
    settings.model.trim() !== ''
  );
}

export function useClozeSuggestions(quote: QuoteEntry) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [state, setState] = useState<ClozeAiState>('checking');
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<ClozeCandidate[] | null>(null);

  useEffect(() => {
    let alive = true;
    getAiSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        if (isConfigured(next)) {
          setState('idle');
          setError('');
        } else {
          setState('disabled');
          setError('Configure AI to use this.');
        }
      })
      .catch(() => {
        if (!alive) return;
        setState('disabled');
        setError('Configure AI to use this.');
      });
    return () => {
      alive = false;
    };
  }, []);

  async function requestSuggestions() {
    if (!settings || !isConfigured(settings)) {
      setState('disabled');
      setError('Configure AI to use this.');
      return;
    }
    setState('loading');
    setError('');
    setCandidates(null);
    try {
      const granted = await requestAiSettingsPermission(settings);
      if (!granted) {
        setState('error');
        setError('Permission denied for AI provider.');
        return;
      }
      const result = await fetchClozeSuggestions({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        provider: settings.provider,
        quoteText: quote.text,
      });
      if (!result.ok) {
        setState('error');
        setError(result.reason);
        return;
      }
      setCandidates(suggestionsToCandidates(quote.text, result.suggestions, quote.clozes ?? []));
      setState('idle');
    } catch {
      setState('error');
      setError('Provider unreachable; retry.');
    }
  }

  function dismissCandidate(id: string) {
    setCandidates((prev) => (prev ? prev.filter((c) => c.cloze.id !== id) : prev));
  }

  return { state, error, candidates, requestSuggestions, dismissCandidate };
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/dashboard/hooks/useClozeSuggestions.ts
git commit -m "feat(cloze): add useClozeSuggestions AI hook"
```

---

### Task 10: Wire the AI "建议填空" button + candidate panel into `ClozeEditor`

**Files:**
- Modify: `entrypoints/dashboard/components/ClozeEditor.tsx`
- Modify: `lib/i18n.ts`
- Test: `tests/cloze-editor.test.tsx`

**Interfaces:**
- Consumes: `useClozeSuggestions` hook; `clozesOverlap` from `@/lib/cloze`.
- Produces: ClozeEditor renders a `建议填空` button gated on AI config (disabled with hint when unconfigured), and on success shows a candidate panel (answer chip + `reason` tooltip + Accept). Accepting adds a `Cloze` via `onChange` and removes it from candidates; an empty result shows `cloze.aiNoSuggestions`.

- [ ] **Step 1: Add the i18n keys (both locales)**

In `lib/i18n.ts` `en` cloze region add:

```ts
    'cloze.aiSuggest': 'Suggest blanks',
    'cloze.aiLoading': 'Generating...',
    'cloze.aiRetry': 'Retry',
    'cloze.aiConfigure': 'Configure AI in Settings to suggest blanks.',
    'cloze.aiNoSuggestions': 'No usable blank suggestions.',
```

In `zh-CN` cloze region add:

```ts
    'cloze.aiSuggest': '建议填空',
    'cloze.aiLoading': '正在生成...',
    'cloze.aiRetry': '重试',
    'cloze.aiConfigure': '请在设置中配置 AI 后再使用填空建议。',
    'cloze.aiNoSuggestions': '没有可用的填空建议。',
```

> The legacy `cloze.suggestBlanks` key may now be unused. After this task, run `grep -rn "cloze.suggestBlanks" entrypoints lib tests`; if there are no references outside `lib/i18n.ts`, delete both locale entries in this task's i18n edit.

- [ ] **Step 2: Write the failing component tests**

Add to `tests/cloze-editor.test.tsx`. These need `getAiSettings`/`fetchClozeSuggestions` mocked — mock the modules at the top of the file (follow how `tests/ai-components.test.tsx` mocks AI settings; if no precedent, use `vi.mock`):

```ts
vi.mock('@/lib/ai/settings', () => ({
  getAiSettings: vi.fn(),
}));
vi.mock('@/lib/ai/permissions', () => ({
  requestAiSettingsPermission: vi.fn(async () => true),
}));
vi.mock('@/lib/ai/client', () => ({
  fetchClozeSuggestions: vi.fn(),
}));
```

(Import the mocked fns with `import { getAiSettings } from '@/lib/ai/settings'` etc. and cast via `vi.mocked(...)`.)

```ts
const DISABLED_SETTINGS = {
  enabled: false, provider: 'deepseek', baseUrl: '', apiKey: '', model: '',
} as const;
const ENABLED_SETTINGS = {
  enabled: true, provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com', apiKey: 'sk', model: 'deepseek-chat',
} as const;

it('disables the AI suggest button when AI is unconfigured', async () => {
  vi.mocked(getAiSettings).mockResolvedValue({ ...DISABLED_SETTINGS });
  const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
  await renderEditorAsync({ quote, onChange: vi.fn(), onUpdate: vi.fn() });
  const btn = findButtonByText('建议填空');
  expect((btn as HTMLButtonElement).disabled).toBe(true);
  expect(container.textContent).toContain('请在设置中配置 AI');
});

it('accepting an AI candidate adds a cloze', async () => {
  vi.mocked(getAiSettings).mockResolvedValue({ ...ENABLED_SETTINGS });
  vi.mocked(fetchClozeSuggestions).mockResolvedValue({
    ok: true, suggestions: [{ answer: '刚需', reason: 'key vocabulary' }],
  });
  const onChange = vi.fn();
  const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
  await renderEditorAsync({ quote, onChange, onUpdate: vi.fn() });

  await actClick(findButtonByText('建议填空'));   // triggers requestSuggestions
  await actClick(findButtonByText('接受'));        // accept the candidate

  expect(onChange).toHaveBeenCalledTimes(1);
  const added = onChange.mock.calls[0][0];
  expect(added).toHaveLength(1);
  expect(quote.text.slice(added[0].start, added[0].end)).toBe('刚需');
});

it('shows the empty state when AI returns no usable spans', async () => {
  vi.mocked(getAiSettings).mockResolvedValue({ ...ENABLED_SETTINGS });
  vi.mocked(fetchClozeSuggestions).mockResolvedValue({ ok: true, suggestions: [{ answer: '股票' }] });
  const quote = makeQuote({ text: '满足人们的刚需', clozes: [] });
  await renderEditorAsync({ quote, onChange: vi.fn(), onUpdate: vi.fn() });
  await actClick(findButtonByText('建议填空'));
  expect(container.textContent).toContain('没有可用的填空建议');
});
```

> `renderEditorAsync` must flush the hook's `getAiSettings().then(...)` — render inside `act` and `await` a microtask flush (e.g. `await act(async () => {})`) before asserting. `actClick` wraps a click in `await act(async () => { button.dispatchEvent(new MouseEvent('click', { bubbles: true })); })`. Use `'接受'` (the existing `cloze.accept` value) for the Accept button. Add these helpers locally if the file lacks them.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/cloze-editor.test.tsx`
Expected: FAIL — no 建议填空 button / AI panel.

- [ ] **Step 4: Wire the hook into `ClozeEditor`**

In `entrypoints/dashboard/components/ClozeEditor.tsx`:
- Add imports:

```ts
import { clozeFromRange, clozesOverlap, parseClozeMarkup, seedMarkup } from '@/lib/cloze';
import { useClozeSuggestions } from '../hooks/useClozeSuggestions';
```

- Inside the component, call the hook:

```ts
const ai = useClozeSuggestions(quote);
```

- Add an accept handler:

```ts
function acceptCandidate(cloze: Cloze) {
  if (clozesOverlap([...clozes, cloze])) return;
  onChange([...clozes, cloze].sort((a, b) => a.start - b.start));
  ai.dismissCandidate(cloze.id);
}
```

- Add the AI candidate panel (render above the actions row):

```tsx
{ai.candidates !== null && (
  <div className="rounded-sm border border-cinnabar-border bg-cinnabar-light p-2">
    {ai.candidates.length === 0 ? (
      <p className="text-xs text-muted">{t(locale, 'cloze.aiNoSuggestions')}</p>
    ) : (
      <div className="flex flex-wrap gap-2">
        {ai.candidates.map((cand) => (
          <div key={cand.cloze.id} className="flex items-center gap-1">
            <span
              title={cand.reason}
              className="rounded-sm border border-cinnabar-border px-2 py-0.5 text-xs text-cinnabar"
            >
              {quote.text.slice(cand.cloze.start, cand.cloze.end)}
            </span>
            <button
              type="button"
              onClick={() => acceptCandidate(cand.cloze)}
              className="rounded-sm border border-cinnabar-border bg-cinnabar px-2 py-0.5 text-xs text-white transition hover:bg-cinnabar/80"
            >
              {t(locale, 'cloze.accept')}
            </button>
          </div>
        ))}
      </div>
    )}
  </div>
)}
{ai.state === 'error' && <p className="text-[11px] text-cinnabar">{ai.error}</p>}
```

- Add the AI suggest button to the actions row. When AI is unconfigured (`checking`/`disabled`) render a disabled button with the configure hint; otherwise a live button:

```tsx
{ai.state === 'checking' || ai.state === 'disabled' ? (
  <div className="space-y-1">
    <button
      type="button"
      disabled
      className="cursor-not-allowed rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted opacity-60"
    >
      {t(locale, 'cloze.aiSuggest')}
    </button>
    <p className="text-[11px] text-muted">{t(locale, 'cloze.aiConfigure')}</p>
  </div>
) : (
  <button
    type="button"
    onClick={ai.requestSuggestions}
    disabled={ai.state === 'loading'}
    className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-xs text-cinnabar transition hover:bg-cinnabar hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
  >
    {ai.state === 'loading'
      ? t(locale, 'cloze.aiLoading')
      : ai.state === 'error'
        ? t(locale, 'cloze.aiRetry')
        : t(locale, 'cloze.aiSuggest')}
  </button>
)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/cloze-editor.test.tsx && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/dashboard/components/ClozeEditor.tsx lib/i18n.ts tests/cloze-editor.test.tsx
git commit -m "feat(cloze): AI-backed 建议填空 button with candidate panel"
```

---

# Phase 4 — i18n + docs cleanup

### Task 11: Final i18n parity check + documentation update

**Files:**
- Modify: `tests/i18n.test.ts`
- Modify: `README.md` and/or `AGENTS.md` (whichever documents cloze authoring)
- Test: `tests/i18n.test.ts`, `tests/i18n-source.test.ts`, full suite

**Interfaces:** none (cleanup task).

- [ ] **Step 1: Add an i18n parity assertion for the new keys**

In `tests/i18n.test.ts`, add a test that the new cloze keys resolve in both locales:

```ts
it('returns new cloze authoring labels in both locales', () => {
  expect(t('en', 'cloze.markBlanks')).toBe('Mark blanks');
  expect(t('en', 'cloze.applyMarks')).toBe('Apply');
  expect(t('en', 'cloze.aiSuggest')).toBe('Suggest blanks');
  expect(t('en', 'cloze.aiNoSuggestions')).toBe('No usable blank suggestions.');
  expect(t('zh-CN', 'cloze.markBlanks')).toBe('手动填空');
  expect(t('zh-CN', 'cloze.applyMarks')).toBe('应用');
  expect(t('zh-CN', 'cloze.aiSuggest')).toBe('建议填空');
  expect(t('zh-CN', 'cloze.aiNoSuggestions')).toBe('没有可用的填空建议。');
});
```

- [ ] **Step 2: Run i18n tests**

Run: `npx vitest run tests/i18n.test.ts tests/i18n-source.test.ts`
Expected: PASS.

- [ ] **Step 3: Confirm no dangling references to removed keys/functions**

Run: `grep -rn "suggestClozes\|noSuggestions\|savedWords\|autoCloze" lib entrypoints tests`
Expected: no matches (the `cloze.suggestBlanks` key should also be gone if you removed it in Task 10).

- [ ] **Step 4: Update documentation**

Find where cloze authoring is described:

Run: `grep -rln "cloze\|填空\|建议填空\|autoCloze" README.md AGENTS.md docs/*.md 2>/dev/null`

In the relevant doc(s), replace any description of save-time auto-cloze / saved-word suggestions with: cloze blanks are now authored manually (wrap answers in `{ }` and Apply) or via AI suggestions (建议填空, requires a configured AI provider); quotes save parked with no blanks. Keep it to a few sentences matching the surrounding doc style.

- [ ] **Step 5: Run the full suite**

Run: `npm test`
Expected: PASS (all files).

- [ ] **Step 6: Commit**

```bash
git add tests/i18n.test.ts README.md AGENTS.md docs
git commit -m "docs(cloze): document manual + AI blank authoring; i18n parity test"
```

---

## Self-Review Notes

- **Spec coverage:** §3 removals → Tasks 1–3; §4 manual input → Tasks 4–5; §5 AI input → Tasks 6–10; §6 data model unchanged (no task needed — no migration); §7 UI summary → Tasks 5 & 10; §8 test plan → tests embedded per task; §9 phased checklist → maps 1:1 to phases here; §10 resolved decisions: brace-wrap (Task 4), text-edit allowed via `onUpdate` (Task 5), `wordId` kept/unset (Tasks 4 & 7 leave it unset), cap 1–5 + reason tooltip (prompt in Task 6, tooltip in Task 10).
- **Decision — offset mapping location:** the spec's test plan lists offset-mapping cases under `ai/cloze-parse.test.ts`; this plan places `suggestionsToCandidates` in `lib/ai/cloze-parse.ts` accordingly (it needs `ClozeSuggestion`), importing `clozesOverlap`/`makeId` from `lib/cloze`. This keeps `lib/cloze.ts` focused on geometry-from-markup.
- **Decision — `max_tokens`:** added an optional `maxTokens` param to the shared `postChatCompletion` (default 1200 preserves `fetchAiInsight`); cloze calls pass 400.
- **Type consistency:** `ClozeCandidate { cloze: Cloze; reason?: string }` is produced in Task 7 and consumed in Tasks 9–10; `ClozeAiState` defined in Task 9, used in Task 10; `onUpdate(patch: Partial<QuoteEntry>)` added to `ClozeEditor` in Task 3, used in Task 5.
- **Brace escaping limitation (noted, acceptable):** `seedMarkup`/`parseClozeMarkup` escape only `{`/`}` (not backslash). Chinese quotes effectively never contain `{`, `}`, or `\`; the round-trip test uses normal text.
