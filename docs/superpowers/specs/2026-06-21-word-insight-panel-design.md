# Word Insight Panel Design

## Summary

Add a local-first Word Insight Panel to make saved words more useful for daily
Chinese reading and study. The panel enriches each word with offline dictionary
definitions, pinyin and tone breakdown, highlighted source examples from the
user's own reading, and a reveal-friendly review view.

This feature should deepen the existing word workflow rather than replace it:
capture stays fast, storage remains local, and the new-tab dashboard becomes the
place where a captured word turns into something learnable.

## Goals

- Show definitions for saved words without requiring a network request.
- Show pinyin, tone numbers, and tone-colored syllable chips for quick
  pronunciation review.
- Highlight the saved word inside captured surrounding sentences.
- Reuse the user's own captured occurrences as example sentences.
- Add a reveal mode to review cards so a word can be tested before showing
  pinyin, definitions, and examples.
- Keep the implementation modular and unit-testable.

## Non-Goals

- Do not add a page overlay or content-script dictionary popup in this phase.
- Do not add AI-generated examples, translations, or explanations.
- Do not add full flashcard scheduling changes beyond the existing review
  actions.
- Do not require any remote API at runtime.
- Do not bring back word tags as part of this feature; the insight panel should
  work from word text, pinyin, notes, and occurrences.

## Current Project Context

The extension already has a strong local capture and review path:

- `lib/capture.ts` creates and dedupes `WordEntry` records.
- `lib/types.ts` keeps persisted data shapes.
- `lib/pinyin.ts` wraps `pinyin-pro` for lazy pinyin generation.
- `entrypoints/newtab/components/WordCard.tsx` renders each saved word and its
  occurrence list.
- `entrypoints/newtab/components/ReviewQueue.tsx` renders due review cards.
- `lib/review.ts` schedules "viewed", "tomorrow", and "later" outcomes.
- `lib/markdown.ts`, `lib/export.ts`, and `lib/backup.ts` preserve the local
  study archive.

The current gap is that a saved word records where it appeared, but does not yet
explain meaning, pronunciation structure, or how it was used in context.

## Recommended Approach

Build a dashboard-first Word Insight Panel.

Each word card gains an expanded insight area with four sections:

1. **Definitions** from a bundled local dictionary index.
2. **Tone chips** generated from `pinyin-pro`.
3. **Source examples** from the word's existing `occurrences[]`, with the word
   highlighted inside `surrounding`.
4. **Component fallback** for phrases that have no exact dictionary match:
   segment the phrase by longest dictionary matches and show definitions for the
   parts that are found.

The review queue gains a compact reveal interaction:

- Before reveal: show the word and source label only.
- After reveal: show pinyin, definitions, and up to two highlighted examples.
- Existing review actions remain unchanged: viewed, tomorrow, later.

This keeps the first version focused on daily usefulness: "What does this word
mean, how is it pronounced, and where did I see it?"

## Dictionary Source And Licensing

Use CC-CEDICT as the first offline dictionary source. The MDBG download page
currently describes CC-CEDICT as licensed under Creative Commons
Attribution-ShareAlike 4.0 and lists a 2026-06-20 release with 125,049 entries.
The CC-CEDICT wiki still describes the project under Creative Commons
Attribution-ShareAlike 3.0. Before committing dictionary data, verify the current
license statement and add attribution in the repository and UI.

Implementation should include:

- `docs/dictionaries/CC-CEDICT.md` with source URL, release timestamp, license
  text/link, attribution, and update instructions.
- A small "Dictionary: CC-CEDICT" attribution link in the insight panel or
  dashboard footer.
- A generated dictionary asset that records `source`, `release`, `license`, and
  `generatedAt` metadata.

The extension should not perform automated scripted access against MDBG at
runtime. Dictionary updates should be a manual or developer-run build step.

References:

- MDBG CC-CEDICT download: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- CC-CEDICT wiki: https://cc-cedict.org/wiki/
- pinyin-pro options: https://pinyin-pro.cn/en/use/pinyin.html

## Data Model

Keep dictionary analysis out of the persisted `WordEntry` for the first version.
Definitions can be regenerated from the bundled dictionary asset, and tone data
can be regenerated from `pinyin-pro`.

Add non-persisted domain types in new pure modules:

```ts
interface DictionaryEntry {
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

interface ToneSyllable {
  text: string;
  pinyin: string;
  tone: 0 | 1 | 2 | 3 | 4;
}

interface HighlightedExample {
  sourceTitle: string;
  sourceUrl: string;
  capturedAt: number;
  before: string;
  match: string;
  after: string;
}

interface WordInsight {
  exactEntries: DictionaryEntry[];
  componentEntries: DictionaryEntry[];
  syllables: ToneSyllable[];
  examples: HighlightedExample[];
  status: 'ready' | 'no-definition' | 'dictionary-unavailable';
}
```

`WordEntry.pinyin` can continue to be filled by the existing pinyin button. The
insight panel may display generated pinyin immediately, but should only persist
`word.pinyin` when the user explicitly uses the existing generation action or a
future "save pinyin" affordance.

## Modules And Components

Add these modules:

- `lib/dictionary.ts`: parse CC-CEDICT lines, build lookup indexes by simplified
  and traditional text, and perform exact lookup.
- `lib/dictionary-loader.ts`: lazy-load the bundled dictionary JSON from the
  extension package in the new-tab dashboard.
- `lib/word-insight.ts`: combine dictionary lookup, fallback segmentation,
  pinyin/tone analysis, and occurrence highlighting into a `WordInsight`.

Add these UI components:

- `WordInsightPanel.tsx`: expanded dashboard panel used inside `WordCard`.
- `ToneChips.tsx`: compact pinyin/tone display.
- `DefinitionList.tsx`: exact and component definitions.
- `SourceExamples.tsx`: highlighted occurrence sentences.
- `ReviewInsightReveal.tsx`: reveal-only subset used by `ReviewQueue`.

Use existing styling conventions: restrained shuimo card surfaces, cinnabar
accent, small controls, no nested decorative cards.

## Data Flow

1. `WordCard` receives a `WordEntry`.
2. When the word is expanded, `useWordInsight(word)` lazy-loads the dictionary if
   it is not already cached.
3. `wordInsightFor(word, dictionary)` computes exact definitions, component
   fallback, tone syllables, and highlighted examples.
4. `WordInsightPanel` renders the result.
5. `ReviewQueue` uses the same pure insight computation after the user reveals a
   due word.

The dictionary loader should cache the parsed index for the dashboard session so
multiple expanded cards do not repeatedly parse the same asset.

## Lookup Behavior

Exact lookup:

- Try the captured word text.
- Try the normalized word key when available.
- Search both simplified and traditional dictionary indexes.
- Return all matching dictionary entries, capped in the UI to the first five.

Component fallback:

- Run only when exact lookup returns no entries.
- Use longest-match dictionary segmentation over the captured word text.
- Keep unmatched characters visible as plain components.
- Show definitions only for matched dictionary components.

No-definition fallback:

- Still show tone chips and source examples.
- Show a clear empty state: "No local dictionary match yet."
- Provide a plain external dictionary search link only if it is a normal user
  click and does not send data automatically.

## Tone Behavior

Use `pinyin-pro` for syllable data. For the first implementation, render one
tone chip per Chinese character in the saved word. Generate the chip data with
`type: 'all'`, `toneType: 'num'`, `nonZh: 'removed'`, and maximum-probability
segmentation where supported by the installed `pinyin-pro` version. The output
should support:

- tone marks for reading,
- tone numbers for practice,
- a neutral-tone value of `0`,
- one chip per Chinese character.

The first implementation does not need to solve all polyphonic ambiguity. When
a dictionary exact match exists, the CC-CEDICT pinyin should be preferred for
the definition section because it is word-level.

## Error Handling

- If the dictionary asset cannot be loaded, show the panel with tone chips and
  source examples, plus a small "dictionary unavailable" message.
- If a CC-CEDICT line cannot be parsed during asset generation, skip it and
  report the count in the generator output.
- If a source URL is missing, render the source title as plain text.
- If `surrounding` is empty, show the source link without a highlighted sentence.
- If a word occurs many times, deduplicate identical surrounding sentences and
  show the newest three examples by default.

## Privacy And Performance

- Runtime dictionary lookup is fully local.
- The dictionary asset should be loaded only in the dashboard, not in the
  background service worker or popup.
- Capture must remain fast and should not do dictionary lookup.
- Review should compute insight only after reveal, or lazily when the card is
  opened.
- The generated dictionary asset should be compact enough for extension
  distribution. If the full generated JSON is too large or slow, the
  implementation plan should split the asset by first character or use a compact
  array format with a small lookup index.

## Testing Plan

Add focused unit tests:

- `tests/dictionary.test.ts`: CC-CEDICT parsing, simplified/traditional indexes,
  exact lookup, multiple definitions, invalid-line handling.
- `tests/word-insight.test.ts`: exact match, no-definition fallback, component
  fallback, tone syllable generation, source sentence highlighting, occurrence
  deduping.
- `tests/review-insight.test.ts` or component tests if the project adds a React
  test renderer later; otherwise keep review reveal logic in pure functions and
  test those.

Run existing verification before claiming implementation complete:

```bash
npm run compile
npm test
```

For UI implementation, manually check the dashboard in WXT dev mode with words
that cover exact matches, phrases, unmatched text, multiple occurrences, and
empty surrounding context.

## Implementation Phases

1. Add dictionary parser, fixture tests, and license/attribution docs.
2. Add generated dictionary asset and lazy dashboard loader.
3. Add pure word insight computation and tests.
4. Add `WordInsightPanel` to expanded word cards.
5. Add reveal mode to review cards using the same insight data.
6. Update README with the new study workflow and dictionary attribution.

## Acceptance Criteria

- Expanding a saved word can show local definitions when the dictionary has a
  match.
- Words without a local definition still show pinyin/tone help and source
  examples.
- Phrase words can show component definitions when exact lookup fails.
- Source examples highlight the saved word without mutating stored occurrence
  text.
- Review cards can hide insight until reveal.
- No runtime network request is required for definitions, pinyin, tone display,
  or examples.
- Dictionary attribution is visible in the repo and accessible from the UI.
