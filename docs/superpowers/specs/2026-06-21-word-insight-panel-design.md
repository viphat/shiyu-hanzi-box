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
- Do not bundle, mirror, scrape, cache, or redistribute a Chinese-Chinese
  dictionary dataset in this phase. Native Chinese definitions must come from
  user-initiated external links unless a clearly licensed monolingual dataset is
  selected in a future spec.
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

1. **Definitions** from a bundled local dictionary collection asset.
2. **Tone chips** generated from the same pinyin source used for definitions
   when an exact dictionary match exists.
3. **Source examples** from the word's existing `occurrences[]`, with the word
   highlighted inside `surrounding`.
4. **Component fallback** for phrases that have no exact dictionary match:
   segment the phrase by longest dictionary matches, then fall back to
   single-character entries before leaving any Chinese character undefined.
5. **External dictionary links** for deeper lookup: one Chinese-English link to
   MDBG and one Chinese-Chinese link to 百度汉语. These are normal outbound links
   only; no content is fetched, embedded, scraped, cached, or previewed.

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
  text/link, attribution, update instructions, and a short non-legal compliance
  note.
- A small "Dictionary: CC-CEDICT" attribution link in the insight panel or
  dashboard footer.
- A generated dictionary asset that records `source`, `release`, `license`, and
  `generatedAt` metadata.

Treat CC-CEDICT as a separately licensed dictionary collection asset. The docs
should state that the dictionary data remains under its CC license and that
dictionary modifications or redistributed adapted dictionary data must follow
the applicable ShareAlike terms. The project should not present this as legal
advice or as a replacement for reviewing the current license. Creative Commons
describes ShareAlike as applying to adaptations, while collections can include
CC-licensed material without changing the license applicable to the original
material. The implementation docs should cite those principles and make the
dictionary asset boundary visible.

The extension should not perform automated scripted access against MDBG at
runtime. It also should not perform automated scripted access against
Chinese-Chinese dictionary sites such as 百度汉语. Dictionary updates should be a
manual or developer-run build step.

References:

- MDBG CC-CEDICT download: https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- CC-CEDICT wiki: https://cc-cedict.org/wiki/
- Creative Commons FAQ: https://creativecommons.org/faq/
- Creative Commons licenses: https://creativecommons.org/cc-licenses/
- 百度汉语: https://dict.baidu.com/
- pinyin-pro options: https://pinyin-pro.cn/en/use/pinyin.html

## Data Model

Keep dictionary analysis out of the persisted `WordEntry` for the first version.
Definitions and exact-match tone data can be regenerated from the bundled
dictionary asset. When no exact match exists, fallback tone data can be
regenerated from `pinyin-pro`.

Add non-persisted domain types in new pure modules:

```ts
interface DictionaryAssetMeta {
  source: 'CC-CEDICT';
  sourceUrl: string;
  release: string;
  license: string;
  licenseUrl: string;
  hash: string;
  generatedAt: string;
}

interface CompactDictionaryAsset {
  meta: DictionaryAssetMeta;
  columns: {
    simplified: string[];
    traditional: string[];
    pinyin: string[];
    definitionRanges: Array<[start: number, count: number]>;
    definitions: string[];
  };
}

interface DictionaryEntry {
  index: number;
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

interface ToneChip {
  text: string;
  mark: string;
  numbered: string;
  tone: 0 | 1 | 2 | 3 | 4;
  source: 'dictionary' | 'pinyin-pro';
}

interface HighlightRange {
  start: number;
  end: number;
  text: string;
}

interface HighlightedExample {
  sourceTitle: string;
  sourceUrl: string;
  capturedAt: number;
  snippet: string;
  ranges: HighlightRange[];
}

interface WordInsight {
  displayText: string;
  exactEntries: DictionaryEntry[];
  componentEntries: DictionaryEntry[];
  toneChips: ToneChip[];
  examples: HighlightedExample[];
  externalLinks: Array<{
    label: 'MDBG' | '百度汉语';
    language: 'Chinese-English' | 'Chinese-Chinese';
    url: string;
  }>;
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
- `lib/dictionary-cache.ts`: persist the compact dictionary index in IndexedDB,
  keyed by the generated asset hash.
- `lib/dictionary-loader.ts`: fetch the bundled dictionary manifest and compact
  dictionary JSON from the extension package, then hydrate or rebuild the
  IndexedDB cache.
- `lib/word-insight.ts`: combine dictionary lookup, fallback segmentation,
  pinyin/tone analysis, and occurrence highlighting into a `WordInsight`.
- `lib/external-dictionaries.ts`: build encoded, click-only dictionary URLs for
  MDBG and 百度汉语 without fetching remote content.

Add this build script:

- `scripts/build-dictionary.ts`: read the downloaded CC-CEDICT source text,
  validate/parse lines, emit `public/dictionaries/cc-cedict-manifest.json` and
  `public/dictionaries/cc-cedict.compact.json`, and print skipped-line and asset
  size statistics.

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
2. When the word is expanded, `useWordInsight(word)` fetches the small local
   dictionary manifest from `public/dictionaries/`.
3. `dictionary-loader.ts` checks IndexedDB for a parsed index with the manifest
   hash.
4. If the hash exists, the loader hydrates the index from IndexedDB. If not, it
   fetches `cc-cedict.compact.json`, builds the lookup indexes, and stores them
   in IndexedDB under the new hash.
5. `wordInsightFor(word, dictionary)` computes exact definitions, component
   fallback, tone chips, and highlighted examples.
6. `WordInsightPanel` renders the result.
7. `ReviewQueue` uses the same pure insight computation after the user reveals a
   due word.

The dictionary asset must live under `public/` and be loaded with `fetch()` via
`browser.runtime.getURL(...)`. Do not import it as a JavaScript module, because
the dictionary should not inflate the dashboard JS bundle.

## Dictionary Asset Strategy

Use a compact, generated JSON format from the first implementation phase. The
asset should be columnar rather than a large array of objects:

- parallel arrays for simplified, traditional, and pinyin strings,
- one deduped `definitions[]` pool,
- `[start, count]` ranges from each entry to its definitions,
- metadata containing source, release, license, hash, and generation time.

On first dashboard use after an asset update, build in-memory lookup indexes for
simplified and traditional text, then persist those indexes in IndexedDB. On
subsequent dashboard opens with the same hash, load the parsed cache from
IndexedDB instead of reparsing the full compact asset.

The implementation plan should measure the generated asset size and initial
indexing time. If the compact JSON still causes slow first-load behavior, split
the asset by first Chinese character before adding UI features.

## Lookup Behavior

Exact lookup:

- Try the captured word text.
- Try the normalized word key when available.
- Search both simplified and traditional dictionary indexes.
- Return all matching dictionary entries, capped in the UI to the first five.

Component fallback:

- Run only when exact lookup returns no entries.
- Run only for captured word text at or below `MAX_COMPONENT_LOOKUP_CHARS = 16`
  Chinese characters. Longer saved text is treated as a phrase/sentence: show
  tone help, source examples, and the external lookup link, but skip component
  segmentation.
- Use longest-match dictionary segmentation over the captured word text first.
- For remaining unmatched Chinese characters, try single-character dictionary
  entries.
- Keep only truly unmatched characters visible as plain components.
- Show definitions only for matched dictionary components.

No-definition fallback:

- Still show tone chips and source examples.
- Show a clear empty state: "No local dictionary match yet."
- Provide normal user-click external dictionary search links:
  `https://www.mdbg.net/chinese/dictionary?wd=<encoded word>`.
- Provide a Chinese-Chinese lookup link to 百度汉语:
  `https://hanyu.baidu.com/s?wd=<encoded word>`.
- Do not prefetch, ping, or otherwise send the saved word outside the extension
  before the user clicks either link.

## External Dictionary Links

The insight panel should always offer optional external lookup actions, even
when local CC-CEDICT definitions exist:

- **MDBG** for Chinese-English lookup.
- **百度汉语** for Chinese-Chinese lookup.

These links are off-network until clicked. The extension must not fetch,
preview, scrape, iframe, cache, or store remote dictionary page content. Opening
either link should use a normal browser tab/window navigation initiated by the
user. The link label should make the destination clear before navigation.
Chinese-Chinese support in this phase is therefore a lookup-link surface, not an
in-app native definition surface. Do not copy remote Chinese-Chinese definition
text into extension storage, Markdown exports, backups, or generated assets.

Use the captured display form as the query text by default. If the user captured
traditional text, pass the traditional captured form rather than forcing the
normalized simplified/dedupe key. This keeps external lookup behavior aligned
with what the user saw while reading.

## Tone Behavior

Use one pinyin source per rendered word insight so the definition pinyin and tone
chips do not disagree.

When exact dictionary entries exist:

- Choose the first displayed dictionary entry as the primary pinyin source.
- Build tone chips from that CC-CEDICT pinyin string.
- Convert numbered pinyin such as `Ni3 Hao3` into tone marks and tone numbers
  with a small pure helper.
- Show alternate dictionary pinyin values inside the definition list when the
  exact entries disagree.
- Do not use pinyin-pro-inferred tone chips for the same exact-match word.

When no exact dictionary entry exists:

- Fall back to `pinyin-pro` for tone chips.
- Generate chip data with `type: 'all'`, `toneType: 'num'`,
  `nonZh: 'removed'`, and maximum-probability segmentation where supported by
  the installed `pinyin-pro` version.

The output should support:

- tone marks for reading,
- tone numbers for practice,
- a neutral-tone value of `0`,
- one chip per Chinese character.

The first implementation does not need to solve all polyphonic ambiguity when no
dictionary exact match exists.

## Error Handling

- If the dictionary asset cannot be loaded, show the panel with tone chips and
  source examples, external dictionary links, plus a small "dictionary
  unavailable" message.
- If a CC-CEDICT line cannot be parsed during asset generation, skip it and
  report the count in the generator output.
- If a source URL is missing, render the source title as plain text.
- If `surrounding` is empty, show the source link without a highlighted sentence.
- If a word occurs many times, deduplicate identical surrounding sentences and
  show the newest three examples by default.
- Clip each surrounding sentence to a display snippet before highlighting. Scan
  at most the first 1,000 characters of stored surrounding text, then render a
  compact snippet around matches.
- Highlight all captured-form matches inside the snippet. If none are found, try
  simplified/traditional variants from exact dictionary entries. If still none
  are found, render the snippet without a highlight.

## Privacy And Performance

- Runtime dictionary lookup is fully local.
- The dictionary asset should be loaded only in the dashboard, not in the
  background service worker or popup.
- External dictionary pages are never contacted automatically. MDBG and 百度汉语
  receive the query only after an explicit user click.
- Capture must remain fast and should not do dictionary lookup.
- Review should compute insight only after reveal, or lazily when the card is
  opened.
- First dashboard render must not wait on dictionary indexing.
- First dictionary initialization after an asset update should target under
  1,500 ms on the current development machine, measured and printed during
  manual QA. If it exceeds that budget, split the compact asset by first Chinese
  character before shipping the UI.
- Subsequent dashboard opens with an IndexedDB cache hit should target under
  150 ms to make an index ready for lookup.
- The implementation should report generated asset byte size, IndexedDB cache
  status, and initialization timing in development logs.

## Testing Plan

Add focused unit tests:

- `tests/dictionary.test.ts`: CC-CEDICT parsing, simplified/traditional indexes,
  exact lookup, multiple definitions, invalid-line handling.
- `tests/fixtures/cedict-sample.txt`: tiny dictionary fixture with simplified,
  traditional, single-character, duplicate-pinyin, and invalid-line examples.
- `tests/dictionary-build.test.ts`: compact asset generation shape, hash
  metadata, skipped-line count, and deduped definition ranges.
- `tests/dictionary-cache.test.ts`: IndexedDB cache hit/miss behavior can be
  added if the project adopts a browser-like IndexedDB test shim; otherwise
  keep cache serialization pure and unit-test that boundary.
- `tests/word-insight.test.ts`: exact match, no-definition fallback, component
  fallback, single-character fallback, dictionary-driven tone chips,
  pinyin-pro fallback tone chips, source sentence highlighting, occurrence
  deduping, external link generation, and long-input segmentation caps.
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

1. Add `scripts/build-dictionary.ts`, dictionary fixtures, parser tests, compact
   asset generation tests, and license/attribution docs.
2. Generate the compact dictionary asset under `public/dictionaries/` and record
   asset size plus release hash.
3. Add lazy dashboard loader and IndexedDB cache keyed by the asset hash.
4. Add pure word insight computation and tests.
5. Add `WordInsightPanel` to expanded word cards.
6. Add reveal mode to review cards using the same insight data.
7. Add click-only external lookup buttons for MDBG and 百度汉语.
8. Update README with the new study workflow, dictionary attribution, and
   external dictionary privacy boundary.

## Acceptance Criteria

- Expanding a saved word can show local definitions when the dictionary has a
  match.
- Dictionary assets are fetched from `public/dictionaries/` and are not imported
  into the dashboard JavaScript bundle.
- The parsed dictionary index is persisted in IndexedDB by release hash and is
  reused on subsequent dashboard opens.
- Words without a local definition still show pinyin/tone help and source
  examples.
- Phrase words can show component definitions when exact lookup fails.
- Component fallback includes single-character dictionary entries before leaving
  Chinese characters unmatched.
- Exact dictionary matches drive both definition pinyin and tone chips.
- Source examples highlight the saved word without mutating stored occurrence
  text.
- Source examples try the captured display form first, then simplified and
  traditional variants.
- The insight panel displays the captured word form by default, whether it is
  simplified or traditional.
- Review cards can hide insight until reveal.
- No runtime network request is required for definitions, pinyin, tone display,
  or examples.
- No Chinese-Chinese dictionary data is bundled, mirrored, scraped, cached, or
  redistributed.
- External lookup includes a user-click MDBG link using
  `https://www.mdbg.net/chinese/dictionary?wd=<encoded word>`.
- External lookup also includes a user-click 百度汉语 link using
  `https://hanyu.baidu.com/s?wd=<encoded word>`.
- The extension does not fetch either external dictionary page before the user
  clicks its link.
- First dictionary initialization and subsequent cache-hit timings are measured
  against the budgets in the Privacy And Performance section.
- Dictionary attribution is visible in the repo and accessible from the UI.
