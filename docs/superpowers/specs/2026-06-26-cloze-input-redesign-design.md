# Cloze Input Redesign — Design Spec

**Status:** Proposed
**Date:** 2026-06-26
**Supersedes (input portion of):** `docs/superpowers/specs/2026-06-25-quote-review-cloze-design.md` §4 (cloze creation)
**Scope:** Replace how cloze blanks are *authored*. Remove the saved-words
suggestion engine entirely. Add two input methods: (1) **manual** marking via an
editable text field, and (2) **AI-generated** suggestions (the redesigned
"建议填空"). Everything downstream of a `Cloze` — per-cloze FSRS scheduling,
review UI, parked-quote surfacing, Markdown export, backup — is **unchanged**.
**Related:** `lib/cloze.ts`, `lib/capture.ts`, `lib/ai/*`, `lib/types.ts`,
`entrypoints/dashboard/components/ClozeEditor.tsx`, `QuoteCard.tsx`,
`QuoteList.tsx`, `entrypoints/dashboard/App.tsx`.

---

## 1. Problem

The current "建议填空" suggests blanks only from **already-saved words** that occur
in the quote (`suggestClozes(text, savedWords)`). In practice it almost always
returns `没有新建议`, for two reasons:

1. It can only propose words the user already saved in the Words tab — it does
   not understand arbitrary sentence content.
2. Any saved word that *did* match was already auto-committed as a blank at save
   time (`saveQuote(..., { autoCloze: true })`), and the suggestion panel filters
   out spans already present — so there is nothing new to show.

The result is a button that is effectively dead. The saved-words coupling is the
wrong foundation for authoring blanks and is removed.

## 2. Goals / Non-goals

**Goals**
- Remove the saved-words suggestion engine and the save-time auto-cloze path.
- **Manual input:** let the user mark exactly which span(s) of a quote become
  blanks by editing the sentence text with an inline marker syntax.
- **AI input:** "建议填空" calls the user's configured AI provider to recommend
  blank-worthy spans for the quote, returning candidates the user accepts with
  one click. Reuses the existing AI settings, client, and permission flow.
- A `Cloze` produced by either method is identical to today's (same shape, same
  scheduling, same export).

**Non-goals**
- No change to the `Cloze` data model, FSRS scheduling, review rendering,
  parked-quote filter/count, Markdown `{{cN::...}}` export, or backup format.
- No offline NLP / dictionary segmentation (still out of scope; AI replaces it).
- No new network access beyond the AI provider the user already configures and
  grants host permission to.
- The existing **drag-select** manual path (`clozeFromRange` +
  `resolveSelectionOffsets`) is retained as-is — it works and is complementary.

## 3. What is removed

- `lib/cloze.ts`: delete `suggestClozes` and any helper used **only** by it
  (e.g. `normalizeWithMap` and its source-offset projection). Keep
  `clozeFromRange`, `clozesOverlap`, `normalizeClozes`, `isParkedQuote`,
  `countParkedQuotes`.
- `lib/capture.ts`: remove the `autoCloze` option and the `suggestClozes` call
  from `saveQuote`. Quotes now always save with `clozes: []` (parked) and the
  user adds blanks via manual/AI. `saveQuote(text, src)` returns to a 2-arg
  signature.
- `savedWords` threading: remove the `savedWords` prop chain
  App → `QuoteList` → `QuoteCard` → `ClozeEditor` (no longer needed).
- `ClozeEditor.tsx`: remove `handleSuggest` (saved-words) and its suggestions
  source; the suggestions **panel UI** is kept and repurposed for AI results
  (§5.2).
- Tests: delete `suggestClozes` cases in `tests/cloze.test.ts`; update
  `tests/capture.test.ts` (no autoCloze); update `cloze-editor`/`quote-list`
  tests that pass `savedWords`.

`Cloze.wordId` becomes vestigial (it was only set by saved-word matches). Keep the
optional field for backward compatibility with stored data; new clozes leave it
unset. (Decide in Open Questions whether to drop it.)

## 4. Manual input

### 4.1 Marker syntax

The user marks blanks by **wrapping the answer span in braces** inside an editable
copy of the quote. Brace content is the answer; position is the blank.

```
在各种必要条件中，我认为最重要的，就是能够满足人们的{刚需}，这样才能让大众不断花钱
```

→ one cloze, answer `刚需`, displayed/exported as `{{c1::刚需}}`. Multiple braces
become `c1, c2, …` in document order.

> **Why brace-delimited answers, not bare `{1}` placeholders.** The user's mental
> model is "mark which word becomes a 填空." Wrapping the answer (`{刚需}`) states
> the span and its answer unambiguously at a known position — no separate "answer
> key" and no alignment pass. A bare numbered placeholder (`…的{1}，…`) requires
> recovering the answer by aligning the template against the stored original,
> which is ambiguous when an anchor segment repeats. Brace-wrap is strictly
> simpler and more robust. The numbered-placeholder variant is recorded as Open
> Question 1 if the team prefers it; this spec designs brace-wrap.

### 4.2 Editor affordance

`ClozeEditor` gains a manual-input control:
- A button "手动填空 / Mark blanks" reveals a `<textarea>` seeded with the quote's
  **current text with existing clozes re-expressed as braces** (so editing is
  round-trippable): `seedMarkup(quote.text, quote.clozes)`.
- The user adds/removes braces and clicks "应用 / Apply".
- On apply, parse the marked text (§4.3). On success, replace the quote's clozes
  with the parsed set via `onChange(clozes)`. On failure, show an inline error and
  do not mutate.

### 4.3 Parsing — `parseClozeMarkup`

```ts
// lib/cloze.ts (or lib/cloze-template.ts)
export type ClozeMarkupResult =
  | { ok: true; text: string; clozes: Cloze[] }
  | { ok: false; reason: 'unbalanced' | 'empty-span' | 'overlap' | 'nested' };

export function parseClozeMarkup(markup: string): ClozeMarkupResult;
export function seedMarkup(text: string, clozes: Cloze[]): string;
```

Rules:
- Recognize `{…}` pairs. **No nesting** (reject `{a{b}c}`). Reject unbalanced
  braces. To allow literal braces in a quote, support escaping `\{` / `\}`
  (rare in Chinese text; still handle).
- `text` = the markup with braces stripped (the clean sentence). Each brace pair
  yields a `Cloze` whose `[start, end)` are offsets into `text` (computed while
  stripping, so they account for removed brace characters).
- Reject empty spans (`{}`) and overlap is impossible by construction (pairs are
  disjoint), but still run `clozesOverlap` as a guard.
- Numbering is positional and display-only; ids via `makeId()`; `hint` defaults
  unset (= none); `wordId` unset.

### 4.4 Quote text edits via the editor

The seeded textarea lets the user also edit the **sentence** (not just braces).
On apply, `text` from `parseClozeMarkup` may differ from `quote.text`:
- If `text === quote.text`: only `clozes` changed → `onChange({ clozes })`.
- If `text !== quote.text`: the user edited the sentence. Persist both the new
  `text` and the new `clozes` (`onUpdate({ text, clozes })`). This naturally
  satisfies the original spec's §9 "text edit recomputes spans" because the new
  offsets are derived from the same markup in one pass — no drift.

(Confirm in Open Questions whether editing `quote.text` from the cloze editor is
desired, or whether `text` must equal the stored quote and otherwise error.)

## 5. AI input ("建议填空")

### 5.1 Flow

"建议填空" becomes AI-backed, mirroring the existing word AI-insight flow
(`useAiInsight` + `AskAiButton`):

- Gated on AI being configured: `settings.enabled && apiKey && baseUrl && model`.
  When unconfigured/disabled, the button is disabled with the same
  "Configure AI to use this" affordance the word panel uses.
- On click: ensure host permission (`requestProviderPermission` /
  `hasProviderPermission`), then call the provider with the quote text, parse and
  **validate** the returned spans (§5.3), and render them in the existing
  suggestions panel with Accept buttons. Accepting creates a standard `Cloze`
  (same path as today's `acceptSuggestion`).
- State machine reused from `useAiInsight`: `checking | idle | loading | disabled
  | error`. New hook `useClozeSuggestions(quote)`.

### 5.2 Prompt + client

Reuse the OpenAI-compatible chat path. `postChatCompletion` in `lib/ai/client.ts`
is currently private — export it (or add a thin `fetchClozeSuggestions`) so the
cloze flow can issue a chat call with `response_format: { type: 'json_object' }`.

```ts
// lib/ai/cloze-prompt.ts
export function buildClozeMessages(quoteText: string): AiMessage[];

// lib/ai/cloze-parse.ts
export interface ClozeSuggestion { answer: string; reason?: string; }
export function parseClozeSuggestions(
  content: string,
): { ok: true; suggestions: ClozeSuggestion[] } | { ok: false; reason: string };

// lib/ai/client.ts
export async function fetchClozeSuggestions(params: {
  baseUrl: string; apiKey: string; model: string; provider: AiProvider;
  quoteText: string;
}): Promise<
  | { ok: true; suggestions: ClozeSuggestion[] }
  | { ok: false; reason: string }
>;
```

Prompt contract (system): "Given a Chinese sentence, choose 1–5 spans most worth
testing as fill-in-the-blank cloze deletions (key vocabulary/collocations, not
function words). Return JSON `{ "blanks": [ { "answer": "...", "reason": "..." } ] }`
where each `answer` is an **exact, verbatim substring** of the sentence. No
markdown, JSON only." Cap `max_tokens` modestly.

### 5.3 Validation (AI can hallucinate)

For each returned `answer`:
- It MUST be a non-empty exact substring of `quote.text`. Drop any that is not.
- Map to offsets: choose the **first occurrence not already covered** by an
  accepted/ existing cloze; if all occurrences are covered, drop it.
- Build candidate `Cloze` `{ id, start, end, hint: unset, wordId: unset }`.
- Greedily drop overlaps (`clozesOverlap`), preferring longer spans (reuse the
  same accept-non-overlapping logic the manual/accept path uses).
- Filter out spans already present on the quote (same `[start,end)` filter as
  today).
- If nothing valid remains, show a clear empty state (`没有可用的填空建议`), distinct
  from a provider error.

The accepted candidates are shown in the suggestions panel; the user still
chooses which to commit. AI never auto-commits.

## 6. Data model

`Cloze` is unchanged (`id, start, end, hint?, wordId?, review?`). No migration.
Quotes saved before this change keep their clozes. Quotes saved after this change
start parked (`clozes: []`) and are surfaced by the existing parked filter/count.

## 7. UI summary (ClozeEditor)

Existing chips (remove + hint select) and the drag-select "添加填空" button stay.
Changes:
- Remove the saved-words "建议填空" handler; the **button label `建议填空`**
  now triggers the AI flow (§5), disabled when AI is unconfigured with the
  standard hint.
- Add "手动填空 / Mark blanks" → textarea + Apply (§4.2), with inline parse errors.
- The suggestions panel renders AI candidates (answer chip + reason tooltip +
  Accept), reusing the current panel markup.

New/updated i18n keys (both `en` + `zh-CN`, parity enforced by
`tests/i18n-source.test.ts`): `cloze.markBlanks` ("Mark blanks"/"手动填空"),
`cloze.applyMarks` ("Apply"/"应用"), `cloze.markupHelp` (brief syntax hint),
`cloze.markupError` ("Couldn't read your blanks — check the { } pairs."),
`cloze.aiSuggest` (reuse `cloze.suggestBlanks` label), `cloze.aiConfigure`
("Configure AI in Settings to suggest blanks."), `cloze.aiNoSuggestions`
("No usable blank suggestions."). Drop now-unused `cloze.noSuggestions` if fully
replaced.

## 8. Test plan (Vitest)

- `cloze.test.ts` — delete `suggestClozes` tests; add `parseClozeMarkup`:
  single/multiple braces → correct offsets into the de-braced text; unbalanced /
  nested / empty-span rejected; escaped `\{`; `seedMarkup` round-trips
  (`parseClozeMarkup(seedMarkup(text, clozes))` ⇒ same text + equivalent spans).
- `capture.test.ts` — `saveQuote` no longer auto-clozes; quote saves with
  `clozes: []`; 2-arg signature.
- `ai/cloze-parse.test.ts` — parse valid `{ "blanks": [...] }`; reject malformed
  JSON; ignore non-substring `answer`s; offset mapping picks first uncovered
  occurrence; overlap/duplicate dropped.
- `ai/cloze-client.test.ts` — `fetchClozeSuggestions` posts to `/chat/completions`
  with json_object; maps HTTP errors via the existing classifier (mock fetch).
- `cloze-editor.test.tsx` — manual textarea apply commits parsed clozes and shows
  errors; AI button disabled when unconfigured; accepting an AI candidate adds a
  cloze; no `savedWords` prop required anymore.
- `i18n.test.ts` / `i18n-source.test.ts` — new keys present in both locales.

## 9. Implementation checklist (phased)

**Phase 1 — remove saved-words coupling**
- [ ] Delete `suggestClozes` (+ dead helpers) from `lib/cloze.ts`; update tests.
- [ ] Remove `autoCloze` from `saveQuote`; quotes save `clozes: []`; update tests.
- [ ] Remove `savedWords` prop chain (App → QuoteList → QuoteCard → ClozeEditor).

**Phase 2 — manual marker input**
- [ ] `parseClozeMarkup` + `seedMarkup` + tests.
- [ ] ClozeEditor "手动填空" textarea + Apply + inline errors; quote-text-edit path.

**Phase 3 — AI suggestions**
- [ ] `buildClozeMessages`, `parseClozeSuggestions`, `fetchClozeSuggestions`
      (export/extract `postChatCompletion`); validation §5.3; tests.
- [ ] `useClozeSuggestions` hook; wire `建议填空` button to AI with permission +
      disabled/loading/error states; render candidates in the panel.

**Phase 4 — i18n + docs**
- [ ] Add/adjust i18n keys (both locales); drop unused ones.
- [ ] Update README/AGENTS: cloze blanks are authored manually or via AI; saved-
      word suggestion and save-time auto-cloze removed.

## 10. Resolved decisions

1. **Manual syntax — CONFIRMED: brace-delimited answers `{刚需}`** (auto-numbered to
   `{{c1::…}}`). The bare numbered-placeholder `{1}` + alignment variant is
   rejected (ambiguous on repeated anchors). §4 is the design of record.
2. **Editing `quote.text` from the cloze editor — ALLOWED.** The seeded textarea
   may edit the sentence; on apply, persist both `text` and `clozes`
   (`onUpdate({ text, clozes })`) per §4.4. Offsets are derived from the same
   markup in one pass, so there is no drift.
3. **`Cloze.wordId` — KEEP (no migration).** It is simply never set by the new
   paths; leaving the optional field avoids touching stored data and backup
   validation. Revisit only if it proves confusing.
4. **AI candidates — cap 1–5, modest `max_tokens`; show `reason` as a tooltip**
   on each candidate chip (hidden by default, no extra layout).
