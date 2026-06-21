# Word Insight Panel — Local Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fully offline Word Insight Panel to the new-tab dashboard that shows CC-CEDICT definitions, tone chips, highlighted source examples, component fallback, and external dictionary links for each saved word — plus a reveal mode for review cards.

**Architecture:** Pure, unit-tested modules under `lib/` do all behavior (dictionary parsing, indexing, lookup, insight computation, link building, markdown extension). The dictionary lives under `public/dictionaries/` as a compact columnar JSON, fetched at runtime (not imported), with the parsed index cached in IndexedDB by release hash. A generated build script (`scripts/build-dictionary.ts`) produces the asset. UI components render the pure results. No behavior lives in UI components.

**Tech Stack:** TypeScript, WXT 0.20.26, React 19, Tailwind 4, `pinyin-pro` 3.28, `fflate` (already a dep), Vitest 4, `@webext-core/fake-browser`. Imports use `@/` alias in `entrypoints/` and `tests/`, relative imports in `lib/`.

**Scope:** This is the local-only foundation from the spec. It intentionally does not implement the optional AI Insight Layer, `WordEntry.aiInsight`, AI provider settings, AI host permissions, or AI Markdown export. Those spec sections require a separate follow-up plan.

---

## File Structure

**Create (pure behavior — unit-tested, no Chrome APIs):**
- `lib/dictionary.ts` — parse CC-CEDICT text lines; build compact asset; build lookup indexes; exact + component lookup. Pure.
- `lib/dictionary-cache.ts` — IndexedDB get/set for the parsed index, keyed by asset hash. Thin browser-bound wrapper.
- `lib/dictionary-loader.ts` — fetch manifest + compact JSON from `public/`, hydrate from or rebuild the IndexedDB cache.
- `lib/pinyin-helpers.ts` — convert CC-CEDICT numbered pinyin (`Ni3 Hao3`) to marks/numbers without relying on `pinyin-pro` for Latin input; `pinyin-pro` fallback for Chinese-character tone chips. Pure.
- `lib/word-insight.ts` — combine dictionary lookup, tone analysis, occurrence highlighting, external links into a `WordInsight`. Pure.
- `lib/external-dictionaries.ts` — build encoded, click-only MDBG and 百度汉语 URLs. Pure.

**Create (build script):**
- `scripts/build-dictionary.ts` — read downloaded CC-CEDICT source text, emit `public/dictionaries/cc-cedict-manifest.json` and `public/dictionaries/cc-cedict.compact.json`, print stats. Pure (Node fs).

**Create (data assets + docs):**
- `public/dictionaries/cc-cedict-manifest.json` — small metadata (source, release, license, hash, generatedAt). Generated.
- `public/dictionaries/cc-cedict.compact.json` — compact columnar dictionary. Generated.
- `docs/dictionaries/CC-CEDICT.md` — source URL, release, license, attribution, update instructions, ShareAlike note.

**Create (UI components):**
- `entrypoints/newtab/components/WordInsightPanel.tsx` — top-level panel rendered inside `WordCard` when expanded.
- `entrypoints/newtab/components/ToneChips.tsx` — renders tone chip array.
- `entrypoints/newtab/components/DefinitionList.tsx` — renders exact + component entries.
- `entrypoints/newtab/components/SourceExamples.tsx` — renders highlighted occurrence examples + external links.
- `entrypoints/newtab/components/ReviewInsightReveal.tsx` — reveal-only subset used by `ReviewQueue`.

**Create (hooks):**
- `entrypoints/newtab/hooks/useWordInsight.ts` — lazy-loads the dictionary once per dashboard session and returns insight for a word.

**Create (tests):**
- `tests/fixtures/cedict-sample.txt` — tiny CC-CEDICT fixture.
- `tests/dictionary.test.ts`
- `tests/dictionary-build.test.ts`
- `tests/dictionary-cache.test.ts`
- `tests/dictionary-loader.test.ts`
- `tests/pinyin-helpers.test.ts`
- `tests/word-insight.test.ts`
- `tests/external-dictionaries.test.ts`

**Modify:**
- `lib/types.ts` — add non-persisted insight domain types (`WordInsight`, `DictionaryEntry`, `ToneChip`, `HighlightedExample`, `ExternalDictionaryLink`, asset meta shapes). Persisted `WordEntry` is unchanged.
- `lib/markdown.ts` — add local dictionary lines per word when a dictionary index is available (regenerable, so not persisted). Render local definitions under each word in the daily note.
- `lib/export.ts` — accept an optional dictionary index and pass it into `renderDay` for Markdown/zip export.
- `entrypoints/newtab/components/Toolbar.tsx` — load the dashboard dictionary before Markdown/zip export and gracefully export without dictionary lines if the asset is unavailable.
- `entrypoints/newtab/components/WordCard.tsx` — render `WordInsightPanel` when expanded.
- `entrypoints/newtab/components/ReviewQueue.tsx` — add reveal interaction to word cards.
- `README.md` — document the new study workflow, attribution, and privacy boundary.
- `AGENTS.md` — note the new modules and the dictionary asset strategy in the architecture section.
- `package.json` — add `build:dictionary` script.

---

## Task 0: Confirm clean working tree

**Files:** none.

- [ ] **Step 1: Verify clean tree**

Run: `git status --short`
Expected: empty output (no uncommitted changes). If anything appears, stop and surface it to the user — do not proceed over uncommitted work.

- [ ] **Step 2: Confirm baseline tests pass**

Run: `npm run compile && npm test`
Expected: compile succeeds with no errors; all existing tests pass. If any fail, stop and surface it before proceeding.

---

## Task 1: Non-persisted insight domain types

**Files:**
- Modify: `lib/types.ts` (append at end of file)

This task adds only type declarations. No runtime code changes yet. The types are consumed by later tasks.

- [ ] **Step 1: Read the current end of `lib/types.ts`**

Run: `cat lib/types.ts`
Confirm the file ends with the `EMPTY_INBOX` export so the append target is clear.

- [ ] **Step 2: Append the insight domain types to `lib/types.ts`**

Append exactly:

```ts

// ---------------------------------------------------------------------------
// Word Insight domain types (non-persisted — computed at view time)
// ---------------------------------------------------------------------------

/** Metadata for a generated dictionary asset file. */
export interface DictionaryAssetMeta {
  source: 'CC-CEDICT';
  sourceUrl: string;
  release: string;
  license: string;
  licenseUrl: string;
  hash: string;
  generatedAt: string;
}

/** Compact columnar dictionary asset, as emitted by the build script. */
export interface CompactDictionaryAsset {
  meta: DictionaryAssetMeta;
  columns: {
    simplified: string[];
    traditional: string[];
    pinyin: string[];
    /** [startIndex, count] into the contiguous definitions[] pool, per entry. */
    definitionRanges: Array<[number, number]>;
    definitions: string[];
  };
}

/** One CC-CEDICT entry, after the loader materializes it from the compact asset. */
export interface DictionaryEntry {
  index: number;
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

/** Runtime lookup index materialized from the compact asset. Never persisted in chrome.storage. */
export interface DictionaryIndex {
  /** key = normalized simplified/traditional form; value = matching entries in dictionary order. */
  byForm: Map<string, DictionaryEntry[]>;
  /** Longest normalized dictionary key length, used by component segmentation. */
  maxKeyLength: number;
}

/** One syllable's tone info for the tone-chip display. */
export interface ToneChip {
  text: string;
  mark: string;
  numbered: string;
  tone: 0 | 1 | 2 | 3 | 4;
  source: 'dictionary' | 'pinyin-pro';
}

/** A highlighted range inside a source-example snippet. */
export interface HighlightRange {
  start: number;
  end: number;
  text: string;
}

/** A source occurrence rendered as a highlighted example. */
export interface HighlightedExample {
  sourceTitle: string;
  sourceUrl: string;
  capturedAt: number;
  snippet: string;
  ranges: HighlightRange[];
}

/** A click-only outbound dictionary link (no content fetched). */
export interface ExternalDictionaryLink {
  label: 'MDBG' | '百度汉语';
  language: 'Chinese-English' | 'Chinese-Chinese';
  url: string;
}

/** Result of computing insight for a word. Never persisted. */
export interface WordInsight {
  displayText: string;
  exactEntries: DictionaryEntry[];
  componentEntries: DictionaryEntry[];
  toneChips: ToneChip[];
  examples: HighlightedExample[];
  externalLinks: ExternalDictionaryLink[];
  status: 'ready' | 'no-definition' | 'dictionary-unavailable';
}
```

- [ ] **Step 3: Verify it compiles**

Run: `npm run compile`
Expected: no errors. (Types only — nothing to test at runtime yet.)

- [ ] **Step 4: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add word insight domain types"
```

---

## Task 2: CC-CEDICT line parser (TDD)

**Files:**
- Create: `lib/dictionary.ts`
- Create: `tests/fixtures/cedict-sample.txt`
- Create: `tests/dictionary.test.ts`

The parser converts raw CC-CEDICT text lines into intermediate entries. CC-CEDICT line format:
```
 Traditional Simplified [pin1 yin1] /def 1/def 2/...
```
Comment lines start with `#`. The first comment line of the form `#! date=...` carries the release timestamp.

- [ ] **Step 1: Create the fixture**

Create `tests/fixtures/cedict-sample.txt`:

```
#! date=2026-06-20
# This is a comment line
你好 你好 [ni3 hao3] /hello/good day/
中國 中国 [zhong1 guo2] /China/Middle Kingdom/
行 行 [xing2] /to walk/to travel/OK/
行 行 [hang2] /row/line/profession/
龍 龙 [long2] /dragon/
亂 乱 [luan4] /random text with [brackets] inside/
INVALID LINE WITHOUT BRACKETS
```

Note: the sample deliberately uses multi-char words, single-character entries, duplicate pinyin keys for 行, a traditional/simplified pair for 龍/龙, definitions containing brackets, and one invalid line.

- [ ] **Step 2: Write the failing test**

Create `tests/dictionary.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  parseCedictLine,
  parseCedictText,
  extractRelease,
} from '../lib/dictionary';

const sample = readFileSync(
  join(import.meta.dirname, 'fixtures/cedict-sample.txt'),
  'utf8',
);

describe('parseCedictLine', () => {
  it('parses a normal entry', () => {
    const entry = parseCedictLine('你好 你好 [ni3 hao3] /hello/good day/');
    expect(entry).not.toBeNull();
    expect(entry!.traditional).toBe('你好');
    expect(entry!.simplified).toBe('你好');
    expect(entry!.pinyin).toBe('ni3 hao3');
    expect(entry!.definitions).toEqual(['hello', 'good day']);
  });

  it('returns null for comment lines', () => {
    expect(parseCedictLine('# comment')).toBeNull();
  });

  it('returns null for blank lines', () => {
    expect(parseCedictLine('')).toBeNull();
    expect(parseCedictLine('   ')).toBeNull();
  });

  it('returns null for malformed lines', () => {
    expect(parseCedictLine('INVALID LINE WITHOUT BRACKETS')).toBeNull();
    expect(parseCedictLine('a b not brackets /only defs/')).toBeNull();
  });

  it('preserves bracketed text inside definitions', () => {
    const entry = parseCedictLine(
      '亂 乱 [luan4] /random text with [brackets] inside/',
    );
    expect(entry!.definitions).toEqual(['random text with [brackets] inside']);
  });

  it('drops the trailing empty definition from a trailing slash', () => {
    const entry = parseCedictLine('中國 中国 [zhong1 guo2] /China/Middle Kingdom/');
    expect(entry!.definitions).toEqual(['China', 'Middle Kingdom']);
  });
});

describe('parseCedictText', () => {
  it('skips comments and invalid lines, returns parsed entries', () => {
    const entries = parseCedictText(sample);
    expect(entries).toHaveLength(6);
    expect(entries[0].simplified).toBe('你好');
  });

  it('records skipped line count via the with-stats variant', () => {
    const { entries, skipped } = parseCedictText(sample, { withStats: true });
    expect(entries).toHaveLength(6);
    expect(skipped).toBe(1); // the one INVALID line
  });
});

describe('extractRelease', () => {
  it('reads the release from the #! date marker line', () => {
    expect(extractRelease(sample)).toBe('2026-06-20');
  });

  it('returns "unknown" when no marker is present', () => {
    expect(extractRelease('# just a comment\n你好 你好 [ni3 hao3] /hi/')).toBe(
      'unknown',
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: FAIL — module `../lib/dictionary` not found.

- [ ] **Step 4: Implement the parser**

Create `lib/dictionary.ts`:

```ts
import type { DictionaryEntry } from './types';

/** A raw parsed entry before it is materialized into the compact asset. */
export interface ParsedCedictEntry {
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}

export interface ParseCedictStats {
  entries: ParsedCedictEntry[];
  skipped: number;
}

const LINE_RE =
  /^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.*)\/\s*$/;

/**
 * Parse a single CC-CEDICT line into an entry, or return null for comments,
 * blank lines, and lines that do not match the expected shape.
 */
export function parseCedictLine(line: string): ParsedCedictEntry | null {
  const trimmed = line.trim();
  if (trimmed === '' || trimmed.startsWith('#')) return null;
  const match = LINE_RE.exec(trimmed);
  if (!match) return null;
  const [, traditional, simplified, pinyin, defsBody] = match;
  const definitions = defsBody
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (definitions.length === 0) return null;
  return { traditional, simplified, pinyin, definitions };
}

/**
 * Parse an entire CC-CEDICT document. When `withStats` is set, also returns
 * the count of lines that were skipped (comments do not count as skipped).
 */
export function parseCedictText(text: string): ParsedCedictEntry[];
export function parseCedictText(
  text: string,
  options: { withStats: true },
): ParseCedictStats;
export function parseCedictText(
  text: string,
  options: { withStats?: boolean } = {},
): ParsedCedictEntry[] | ParseCedictStats {
  const entries: ParsedCedictEntry[] = [];
  let skipped = 0;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const parsed = parseCedictLine(line);
    if (parsed) {
      entries.push(parsed);
    } else {
      skipped += 1;
    }
  }
  return options.withStats ? { entries, skipped } : entries;
}

/**
 * Extract the release date from the `#! ... date=YYYY-MM-DD ...` marker line
 * that the CC-CEDICT download places at the top of the file.
 */
export function extractRelease(text: string): string {
  const match = text.match(/^#!.*\bdate=(\d{4}-\d{2}-\d{2})\b/m);
  return match ? match[1] : 'unknown';
}

// Materialized-entry and index/lookup functions are added in later tasks.
// This export keeps the type relationship explicit for downstream tasks.
export type { DictionaryEntry };
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: PASS — all 9 assertions blocks green.

- [ ] **Step 6: Run full compile + tests**

Run: `npm run compile && npm test`
Expected: compile clean, all tests pass.

- [ ] **Step 7: Commit**

```bash
git add lib/dictionary.ts tests/fixtures/cedict-sample.txt tests/dictionary.test.ts
git commit -m "feat: add CC-CEDICT line parser"
```

---

## Task 3: Compact asset builder (TDD)

**Files:**
- Modify: `lib/dictionary.ts` (add `buildCompactAsset`, `materializeEntry`, and helpers)
- Create: `tests/dictionary-build.test.ts`

The compact asset stores definitions in a contiguous pool and dedupes identical definition sequences while preserving `[start, count]` ranges, so materialization is correct and the asset stays compact.

- [ ] **Step 1: Write the failing test**

Create `tests/dictionary-build.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCompactAsset, materializeEntries } from '../lib/dictionary';
import type { CompactDictionaryAsset } from '../lib/types';

const sample = readFileSync(
  join(import.meta.dirname, 'fixtures/cedict-sample.txt'),
  'utf8',
);

describe('buildCompactAsset', () => {
  it('builds a compact asset with metadata and columnar data', () => {
    const asset = buildCompactAsset(sample, {
      sourceUrl: 'https://example/cedict',
      license: 'CC-BY-SA 4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    });
    expect(asset.meta.source).toBe('CC-CEDICT');
    expect(asset.meta.release).toBe('2026-06-20');
    expect(asset.meta.sourceUrl).toBe('https://example/cedict');
    expect(asset.meta.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(asset.meta.hash).toMatch(/^[0-9a-f]{8,}$/);
    expect(asset.columns.simplified).toHaveLength(6);
    expect(asset.columns.traditional).toHaveLength(6);
    expect(asset.columns.pinyin).toHaveLength(6);
    expect(asset.columns.definitionRanges).toHaveLength(6);
  });

  it('dedupes identical definition sequences across entries', () => {
    const asset = buildCompactAsset('A A [a1] /shared def/\nB B [b1] /shared def/', {
      sourceUrl: '',
      license: '',
      licenseUrl: '',
    });
    // Two entries, both pointing at the single shared definition string.
    expect(asset.columns.definitions).toEqual(['shared def']);
    expect(asset.columns.definitionRanges).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  it('stores ranges that cover each entry definitions exactly', () => {
    const asset = buildCompactAsset(sample, {
      sourceUrl: '',
      license: '',
      licenseUrl: '',
    });
    expect(asset.columns.definitionRanges[0]).toEqual([0, 2]); // hello, good day
  });

  it('keeps repeated single definitions from corrupting later multi-definition ranges', () => {
    const asset = buildCompactAsset(
      [
        'A A [a1] /first/shared/',
        'B B [b1] /other/',
        'C C [c1] /shared/',
      ].join('\n'),
      { sourceUrl: '', license: '', licenseUrl: '' },
    );
    const entries = materializeEntries(asset);
    expect(entries[0].definitions).toEqual(['first', 'shared']);
    expect(entries[1].definitions).toEqual(['other']);
    expect(entries[2].definitions).toEqual(['shared']);
  });
});

describe('materializeEntries', () => {
  it('rebuilds DictionaryEntry[] from a compact asset', () => {
    const asset: CompactDictionaryAsset = buildCompactAsset(sample, {
      sourceUrl: '',
      license: '',
      licenseUrl: '',
    });
    const entries = materializeEntries(asset);
    expect(entries).toHaveLength(6);
    expect(entries[0]).toMatchObject({
      index: 0,
      traditional: '你好',
      simplified: '你好',
      pinyin: 'ni3 hao3',
      definitions: ['hello', 'good day'],
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dictionary-build.test.ts`
Expected: FAIL — `buildCompactAsset` / `materializeEntries` not exported.

- [ ] **Step 3: Add the build + materialize functions**

Append to `lib/dictionary.ts` (after the existing exports):

```ts

import type { CompactDictionaryAsset } from './types';

export interface BuildCompactAssetOptions {
  sourceUrl: string;
  license: string;
  licenseUrl: string;
}

/**
 * Build a compact columnar asset from raw CC-CEDICT text. Definitions are
 * stored contiguously and identical definition sequences are deduped. Each entry
 * stores a [start, count] range into the definitions pool.
 */
export function buildCompactAsset(
  text: string,
  options: BuildCompactAssetOptions,
): CompactDictionaryAsset {
  const { entries, skipped } = parseCedictText(text, { withStats: true });
  void skipped; // surfaced by the build script's console output, not the asset

  const simplified: string[] = [];
  const traditional: string[] = [];
  const pinyin: string[] = [];
  const definitionRanges: Array<[number, number]> = [];
  const definitions: string[] = [];
  const defSequenceIndex = new Map<string, [number, number]>();

  for (const entry of entries) {
    simplified.push(entry.simplified);
    traditional.push(entry.traditional);
    pinyin.push(entry.pinyin);
    const sequenceKey = JSON.stringify(entry.definitions);
    const existingRange = defSequenceIndex.get(sequenceKey);
    if (existingRange) {
      definitionRanges.push(existingRange);
      continue;
    }

    const start = definitions.length;
    definitions.push(...entry.definitions);
    const range: [number, number] = [start, entry.definitions.length];
    defSequenceIndex.set(sequenceKey, range);
    definitionRanges.push(range);
  }

  const meta = {
    source: 'CC-CEDICT' as const,
    sourceUrl: options.sourceUrl,
    release: extractRelease(text),
    license: options.license,
    licenseUrl: options.licenseUrl,
    hash: hashAsset({ simplified, traditional, pinyin, definitionRanges, definitions }),
    generatedAt: new Date().toISOString(),
  };

  return { meta, columns: { simplified, traditional, pinyin, definitionRanges, definitions } };
}

/** Rebuild DictionaryEntry[] from a compact asset (used by the loader). */
export function materializeEntries(asset: CompactDictionaryAsset): DictionaryEntry[] {
  const { columns } = asset;
  return columns.simplified.map((_, index) => {
    const [start, count] = columns.definitionRanges[index];
    const definitions = columns.definitions.slice(start, start + count);
    return {
      index,
      traditional: columns.traditional[index],
      simplified: columns.simplified[index],
      pinyin: columns.pinyin[index],
      definitions,
    };
  });
}

function hashAsset(columns: CompactDictionaryAsset['columns']): string {
  const json = JSON.stringify(columns);
  let hash = 0x811c9dc5;
  for (let i = 0; i < json.length; i += 1) {
    hash ^= json.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dictionary-build.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dictionary.ts tests/dictionary-build.test.ts
git commit -m "feat: build and materialize compact CC-CEDICT asset"
```

---

## Task 4: Lookup indexes and exact lookup (TDD)

**Files:**
- Modify: `lib/dictionary.ts` (use the `DictionaryIndex` type from `lib/types.ts`; add `buildIndex`, `lookupExact`)
- Create: append to `tests/dictionary.test.ts`

- [ ] **Step 1: Append lookup tests to `tests/dictionary.test.ts`**

Append (inside a new describe block at the end of the file):

```ts
import { buildIndex, lookupExact } from '../lib/dictionary';
import type { DictionaryEntry } from '../lib/types';

const sampleEntries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['hello', 'good day'] },
  { index: 1, traditional: '中國', simplified: '中国', pinyin: 'zhong1 guo2', definitions: ['China'] },
  { index: 2, traditional: '行', simplified: '行', pinyin: 'xing2', definitions: ['to walk'] },
  { index: 3, traditional: '行', simplified: '行', pinyin: 'hang2', definitions: ['row'] },
  { index: 4, traditional: '龍', simplified: '龙', pinyin: 'long2', definitions: ['dragon'] },
];

describe('buildIndex + lookupExact', () => {
  const index = buildIndex(sampleEntries);

  it('finds entries by simplified form', () => {
    const hits = lookupExact(index, '你好');
    expect(hits).toHaveLength(1);
    expect(hits[0].pinyin).toBe('ni3 hao3');
  });

  it('finds entries by traditional form', () => {
    const hits = lookupExact(index, '龍');
    expect(hits).toHaveLength(1);
    expect(hits[0].definitions).toEqual(['dragon']);
  });

  it('returns all entries when simplified maps to multiple (polyphone)', () => {
    const hits = lookupExact(index, '行');
    expect(hits).toHaveLength(2);
    expect(hits.map((h) => h.pinyin).sort()).toEqual(['hang2', 'xing2']);
  });

  it('returns an empty array when no match', () => {
    expect(lookupExact(index, '不存在的词')).toEqual([]);
  });

  it('normalizes whitespace in lookup keys', () => {
    const hits = lookupExact(index, '中 国');
    expect(hits).toHaveLength(1);
    expect(hits[0].definitions).toEqual(['China']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: FAIL — `buildIndex` / `lookupExact` not exported.

- [ ] **Step 3: Implement the index**

Append to `lib/dictionary.ts`:

```ts

// Also change the existing top import to:
// import type { CompactDictionaryAsset, DictionaryEntry, DictionaryIndex } from './types';

const NO_WHITESPACE = /\s+/g;

function formKey(surface: string): string {
  return surface.replace(NO_WHITESPACE, '').toLowerCase();
}

/** Build a lookup index over a materialized entry list. */
export function buildIndex(entries: DictionaryEntry[]): DictionaryIndex {
  const byForm = new Map<string, DictionaryEntry[]>();
  let maxKeyLength = 0;
  for (const entry of entries) {
    for (const surface of new Set([entry.simplified, entry.traditional])) {
      const key = formKey(surface);
      const list = byForm.get(key);
      if (list) list.push(entry);
      else byForm.set(key, [entry]);
      maxKeyLength = Math.max(maxKeyLength, Array.from(key).length);
    }
  }
  return { byForm, maxKeyLength };
}

/** Return all entries whose simplified or traditional form matches `surface`. */
export function lookupExact(index: DictionaryIndex, surface: string): DictionaryEntry[] {
  return index.byForm.get(formKey(surface)) ?? [];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dictionary.ts tests/dictionary.test.ts
git commit -m "feat: add dictionary lookup index and exact lookup"
```

---

## Task 5: Component fallback segmentation (TDD)

**Files:**
- Modify: `lib/dictionary.ts` (add `segmentComponents`)
- Create: append to `tests/dictionary.test.ts`

Component fallback runs only when exact lookup returns nothing: it segments the captured text by longest dictionary match, then falls back to single-char entries, leaving truly unmatched characters as plain components.

- [ ] **Step 1: Append segmentation tests to `tests/dictionary.test.ts`**

Append:

```ts
import { segmentComponents } from '../lib/dictionary';

describe('segmentComponents', () => {
  // Index where: '你好' is exact, '龙' is single-char, '云' single-char.
  // (entries reuse sampleEntries from the buildIndex describe block.)
  const idx = buildIndex([
    ...sampleEntries,
    { index: 5, traditional: '雲', simplified: '云', pinyin: 'yun2', definitions: ['cloud'] },
  ]);

  it('returns no segments when the text is an exact match (caller decides)', () => {
    // Caller is expected to try exact first. Here we verify segmentation still
    // returns something reasonable for an exact-match word if asked directly.
    const segs = segmentComponents(idx, '你好');
    expect(segs.map((s) => s.entry?.simplified ?? s.text)).toContain('你好');
  });

  it('segments multi-char text into matched + single-char components', () => {
    const segs = segmentComponents(idx, '龙云');
    // 龙 and 云 are both single-char entries; expect two matched segments.
    const matched = segs.filter((s) => s.entry !== undefined);
    expect(matched.map((s) => s.entry!.simplified).sort()).toEqual(['云', '龙']);
  });

  it('leaves unmatched characters as plain components', () => {
    const segs = segmentComponents(idx, '龙雨');
    // 雨 has no entry: expect 龙 matched, 雨 plain.
    expect(segs).toHaveLength(2);
    expect(segs[0].entry?.simplified).toBe('龙');
    expect(segs[1].entry).toBeUndefined();
    expect(segs[1].text).toBe('雨');
  });

  it('prefers longest dictionary match', () => {
    const segs = segmentComponents(idx, '你好龙');
    // 你好 matched as one segment, then 龙 as single char.
    expect(segs).toHaveLength(2);
    expect(segs[0].entry?.simplified).toBe('你好');
    expect(segs[1].entry?.simplified).toBe('龙');
  });

  it('can choose dictionary entries longer than four characters', () => {
    const longIndex = buildIndex([
      ...sampleEntries,
      {
        index: 6,
        traditional: '中华人民共和国',
        simplified: '中华人民共和国',
        pinyin: 'zhong1 hua2 ren2 min2 gong4 he2 guo2',
        definitions: ['People’s Republic of China'],
      },
    ]);
    const segs = segmentComponents(longIndex, '中华人民共和国龙');
    expect(segs[0].entry?.simplified).toBe('中华人民共和国');
    expect(segs[1].entry?.simplified).toBe('龙');
  });

  it('skips non-Chinese characters without matching them', () => {
    const segs = segmentComponents(idx, '龙abc云');
    const chinese = segs.filter((s) => /[\u4e00-\u9fff]/.test(s.text));
    expect(chinese.map((s) => s.entry?.simplified)).toEqual(['龙', '云']);
  });

  it('returns an empty array for input above the length cap', () => {
    const long = '龙'.repeat(17);
    expect(segmentComponents(idx, long)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: FAIL — `segmentComponents` not exported.

- [ ] **Step 3: Implement segmentation**

Append to `lib/dictionary.ts`:

```ts

/** Maximum captured-text length (in Chinese characters) to segment. */
export const MAX_COMPONENT_LOOKUP_CHARS = 16;

const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;

export interface ComponentSegment {
  text: string;
  entry?: DictionaryEntry;
}

/**
 * Segment `text` into components using longest-match, then single-char
 * fallback. Returns `[]` when the text exceeds MAX_COMPONENT_LOOKUP_CHARS
 * Chinese characters (caller should show tone help + links only).
 */
export function segmentComponents(
  index: DictionaryIndex,
  text: string,
): ComponentSegment[] {
  const cjkCount = Array.from(text).filter((ch) => CJK.test(ch)).length;
  if (cjkCount > MAX_COMPONENT_LOOKUP_CHARS) return [];

  const chars = Array.from(text);
  const segments: ComponentSegment[] = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (!CJK.test(ch)) {
      // skip non-Chinese without emitting (kept out of the segment list)
      i += 1;
      continue;
    }
    let matched: { end: number; entry: DictionaryEntry } | null = null;
    for (let len = Math.min(index.maxKeyLength, chars.length - i); len >= 1; len -= 1) {
      const slice = chars.slice(i, i + len).join('');
      const hits = lookupExact(index, slice);
      if (hits.length > 0) {
        // Prefer a single-char hit only if no multi-char hit exists; longest
        // first means we take the first non-empty hit.
        matched = { end: i + len, entry: hits[0] };
        break;
      }
    }
    if (matched) {
      segments.push({ text: chars.slice(i, matched.end).join(''), entry: matched.entry });
      i = matched.end;
    } else {
      segments.push({ text: ch });
      i += 1;
    }
  }
  return segments;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dictionary.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dictionary.ts tests/dictionary.test.ts
git commit -m "feat: add component fallback segmentation"
```

---

## Task 6: Pinyin helpers — CEDICT numbers to marks/numbers (TDD)

**Files:**
- Create: `lib/pinyin-helpers.ts`
- Create: `tests/pinyin-helpers.test.ts`

When an exact CEDICT match exists, tone chips come from the CEDICT pinyin string (`Ni3 Hao3`) converted via `pinyin-pro`. When no match exists, chips come from `pinyin-pro` character inference.

- [ ] **Step 1: Write the failing test**

Create `tests/pinyin-helpers.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  cedictPinyinToChips,
  inferToneChips,
} from '../lib/pinyin-helpers';
import type { ToneChip } from '../lib/types';

describe('cedictPinyinToChips', () => {
  it('converts numbered CEDICT pinyin into tone chips', () => {
    const chips = cedictPinyinToChips('ni3 hao3', '你好');
    expect(chips).toHaveLength(2);
    expect(chips[0]).toMatchObject<ToneChip>({
      text: '你',
      mark: 'nǐ',
      numbered: 'ni3',
      tone: 3,
      source: 'dictionary',
    });
  });

  it('maps neutral tone to 0', () => {
    const chips = cedictPinyinToChips('ni3 hao5', '你好');
    expect(chips[1].tone).toBe(0);
    expect(chips[1].numbered).toBe('hao5');
  });

  it('returns one chip per space-separated syllable', () => {
    const chips = cedictPinyinToChips('zhong1 guo2', '中国');
    expect(chips.map((c) => c.mark)).toEqual(['zhōng', 'guó']);
  });

  it('handles u-colon umlaut notation used by CEDICT', () => {
    const chips = cedictPinyinToChips('lu:4', '绿');
    expect(chips[0].mark).toBe('lǜ');
    expect(chips[0].tone).toBe(4);
  });
});

describe('inferToneChips', () => {
  it('infers one tone chip per Chinese character with no dictionary match', () => {
    const chips = inferToneChips('你好');
    expect(chips).toHaveLength(2);
    expect(chips[0].source).toBe('pinyin-pro');
    expect(chips.map((c) => c.text).join('')).toBe('你好');
    expect(chips.every((c) => c.tone >= 0 && c.tone <= 4)).toBe(true);
  });

  it('removes non-Chinese characters', () => {
    const chips = inferToneChips('你好!');
    expect(chips).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/pinyin-helpers.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/pinyin-helpers.ts`:

```ts
import { pinyin } from 'pinyin-pro';
import type { ToneChip } from './types';

const CJK = /[\u3400-\u9fff]/;
const TONE_NUM: Record<string, 0 | 1 | 2 | 3 | 4> = {
  '0': 0,
  '1': 1,
  '2': 2,
  '3': 3,
  '4': 4,
  '5': 0,
};

const MARKS: Record<string, [string, string, string, string]> = {
  a: ['ā', 'á', 'ǎ', 'à'],
  e: ['ē', 'é', 'ě', 'è'],
  i: ['ī', 'í', 'ǐ', 'ì'],
  o: ['ō', 'ó', 'ǒ', 'ò'],
  u: ['ū', 'ú', 'ǔ', 'ù'],
  ü: ['ǖ', 'ǘ', 'ǚ', 'ǜ'],
};

/**
 * Convert a CC-CEDICT numbered pinyin string ("ni3 hao3") into per-syllable
 * tone chips aligned to the Chinese characters in `word`.
 */
export function cedictPinyinToChips(
  cedictPinyin: string,
  word: string,
): ToneChip[] {
  const chars = chineseChars(word);
  return cedictPinyin
    .trim()
    .split(/\s+/)
    .filter((syl) => syl.length > 0)
    .map((syl, index) => {
      const toneDigit = syl.slice(-1);
      const tone = TONE_NUM[toneDigit] ?? 0;
      return {
        text: chars[index] ?? '',
        mark: markNumberedPinyin(syl, tone),
        numbered: syl,
        tone,
        source: 'dictionary' as const,
      };
    });
}

/**
 * Infer one tone chip per Chinese character using pinyin-pro, used when no
 * exact dictionary match exists.
 */
export function inferToneChips(word: string): ToneChip[] {
  const chars = chineseChars(word);
  return chars.map((ch) => {
    const all = pinyin(ch, {
      type: 'all',
      toneType: 'num',
      nonZh: 'removed',
    });
    // pinyin-pro returns an array of per-character objects with type:'all'.
    const item = Array.isArray(all) ? all[0] : all;
    const mark = pinyin(ch, { toneType: 'symbol', nonZh: 'removed' }).trim();
    const tone = (Number(item?.num ?? 0) as 0 | 1 | 2 | 3 | 4);
    const numbered = String(item?.pinyin ?? pinyin(ch, { toneType: 'num', nonZh: 'removed' })).trim();
    return { text: ch, mark, numbered, tone, source: 'pinyin-pro' as const };
  });
}

function chineseChars(word: string): string[] {
  return Array.from(word).filter((ch) => CJK.test(ch));
}

function markNumberedPinyin(numbered: string, tone: 0 | 1 | 2 | 3 | 4): string {
  const base = numbered.replace(/[0-5]$/, '').replace(/u:/g, 'ü').replace(/v/g, 'ü');
  if (tone === 0) return base;

  const lower = base.toLowerCase();
  const vowelIndex = chooseToneVowelIndex(lower);
  if (vowelIndex === -1) return base;

  const vowel = lower[vowelIndex];
  const marked = MARKS[vowel]?.[tone - 1];
  if (!marked) return base;
  return base.slice(0, vowelIndex) + marked + base.slice(vowelIndex + 1);
}

function chooseToneVowelIndex(syllable: string): number {
  const a = syllable.indexOf('a');
  if (a !== -1) return a;
  const e = syllable.indexOf('e');
  if (e !== -1) return e;
  const ou = syllable.indexOf('ou');
  if (ou !== -1) return ou;
  for (let i = syllable.length - 1; i >= 0; i -= 1) {
    if ('ioüu'.includes(syllable[i])) return i;
  }
  return -1;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/pinyin-helpers.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/pinyin-helpers.ts tests/pinyin-helpers.test.ts
git commit -m "feat: add pinyin helpers for tone chips"
```

---

## Task 7: External dictionary link builder (TDD)

**Files:**
- Create: `lib/external-dictionaries.ts`
- Create: `tests/external-dictionaries.test.ts`

Click-only, encoded URLs. No fetching.

- [ ] **Step 1: Write the failing test**

Create `tests/external-dictionaries.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildExternalLinks } from '../lib/external-dictionaries';

describe('buildExternalLinks', () => {
  it('builds an MDBG link with the encoded word', () => {
    const links = buildExternalLinks('你好');
    const mdbg = links.find((l) => l.label === 'MDBG')!;
    expect(mdbg.url).toBe(
      'https://www.mdbg.net/chinese/dictionary?wd=' + encodeURIComponent('你好'),
    );
    expect(mdbg.language).toBe('Chinese-English');
  });

  it('builds a 百度汉语 link with the encoded word', () => {
    const links = buildExternalLinks('你好');
    const baidu = links.find((l) => l.label === '百度汉语')!;
    expect(baidu.url).toBe('https://hanyu.baidu.com/s?wd=' + encodeURIComponent('你好'));
    expect(baidu.language).toBe('Chinese-Chinese');
  });

  it('preserves traditional characters in the query', () => {
    const links = buildExternalLinks('龍');
    expect(links[0].url).toContain(encodeURIComponent('龍'));
  });

  it('returns both links in a stable order (MDBG first)', () => {
    const links = buildExternalLinks('龙');
    expect(links.map((l) => l.label)).toEqual(['MDBG', '百度汉语']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/external-dictionaries.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/external-dictionaries.ts`:

```ts
import type { ExternalDictionaryLink } from './types';

/**
 * Build click-only outbound dictionary links. No remote content is fetched,
 * previewed, iframed, or cached — these are plain anchor hrefs the user
 * chooses to open.
 */
export function buildExternalLinks(word: string): ExternalDictionaryLink[] {
  const q = encodeURIComponent(word);
  return [
    {
      label: 'MDBG',
      language: 'Chinese-English',
      url: `https://www.mdbg.net/chinese/dictionary?wd=${q}`,
    },
    {
      label: '百度汉语',
      language: 'Chinese-Chinese',
      url: `https://hanyu.baidu.com/s?wd=${q}`,
    },
  ];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/external-dictionaries.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/external-dictionaries.ts tests/external-dictionaries.test.ts
git commit -m "feat: add external dictionary link builder"
```

---

## Task 8: Highlighted source examples (TDD)

**Files:**
- Modify: `lib/word-insight.ts` (create) — but split: this task adds only the example-highlighting pure function.
- Create: `tests/word-insight.test.ts`

Highlight the captured word inside each occurrence's `surrounding`, dedupe identical sentences, cap to the newest 3.

- [ ] **Step 1: Write the failing test**

Create `tests/word-insight.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildHighlightedExamples } from '../lib/word-insight';
import type { Occurrence } from '../lib/types';

const occ = (over: Partial<Occurrence>): Occurrence => ({
  sourceTitle: 'T',
  sourceUrl: 'https://t.com/1',
  sourceDomain: 't.com',
  surrounding: '',
  capturedAt: 1,
  ...over,
});

describe('buildHighlightedExamples', () => {
  it('highlights the captured word inside surrounding text', () => {
    const ex = buildHighlightedExamples('你好', [
      occ({ surrounding: '今天 我 看到 你好 世界 这句', capturedAt: 1 }),
    ]);
    expect(ex).toHaveLength(1);
    expect(ex[0].ranges).toHaveLength(1);
    expect(ex[0].ranges[0].text).toBe('你好');
    expect(ex[0].snippet).toContain('你好');
  });

  it('highlights all occurrences of the word in the snippet', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: '龙 和 龙 是 不同的 龙', capturedAt: 1 }),
    ]);
    expect(ex[0].ranges.length).toBe(3);
  });

  it('dedupes identical surrounding sentences keeping the newest', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: '同 一 句 龙', capturedAt: 1 }),
      occ({ surrounding: '同 一 句 龙', capturedAt: 5 }),
      occ({ surrounding: '同 一 句 龙', capturedAt: 3 }),
    ]);
    expect(ex).toHaveLength(1);
    expect(ex[0].capturedAt).toBe(5);
  });

  it('caps to the newest three examples', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: 'a 龙', capturedAt: 1 }),
      occ({ surrounding: 'b 龙', capturedAt: 2 }),
      occ({ surrounding: 'c 龙', capturedAt: 3 }),
      occ({ surrounding: 'd 龙', capturedAt: 4 }),
      occ({ surrounding: 'e 龙', capturedAt: 5 }),
    ]);
    expect(ex).toHaveLength(3);
    expect(ex.map((e) => e.capturedAt)).toEqual([5, 4, 3]);
  });

  it('returns an example without ranges when surrounding is empty', () => {
    const ex = buildHighlightedExamples('龙', [occ({ surrounding: '' })]);
    expect(ex).toHaveLength(1);
    expect(ex[0].ranges).toEqual([]);
    expect(ex[0].snippet).toBe('');
  });

  it('clips surrounding to the first 1000 characters before scanning', () => {
    const long = 'x'.repeat(1200);
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: long + '龙', capturedAt: 1 }),
    ]);
    // The 龙 is past the 1000-char scan window, so no range is produced.
    expect(ex[0].ranges).toEqual([]);
  });

  it('renders snippet without a highlight when the word is not found', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: '这里 没有 那个 字', capturedAt: 1 }),
    ]);
    expect(ex[0].ranges).toEqual([]);
    expect(ex[0].snippet).toContain('这里');
  });

  it('falls back to simplified/traditional variants when captured form is absent', () => {
    const ex = buildHighlightedExamples('龍', [
      occ({ surrounding: '这里 出现 的 是 龙', capturedAt: 1 }),
    ], ['龙']);
    expect(ex[0].ranges).toHaveLength(1);
    expect(ex[0].ranges[0].text).toBe('龙');
  });

  it('clips long surrounding text to a compact snippet around the match', () => {
    const ex = buildHighlightedExamples('龙', [
      occ({ surrounding: `${'前'.repeat(200)}龙${'后'.repeat(200)}`, capturedAt: 1 }),
    ]);
    expect(ex[0].snippet.length).toBeLessThan(180);
    expect(ex[0].snippet).toContain('龙');
    expect(ex[0].ranges[0].text).toBe('龙');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/word-insight.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/word-insight.ts`:

```ts
import type { HighlightedExample, HighlightRange, Occurrence } from './types';

const SCAN_LIMIT = 1000;

/**
 * Build highlighted source examples from a word's occurrences. Dedupes
 * identical surrounding text (keeping the newest), caps to the newest three,
 * scans at most the first 1000 characters of each surrounding for matches.
 */
export function buildHighlightedExamples(
  word: string,
  occurrences: Occurrence[],
  variants: string[] = [],
): HighlightedExample[] {
  if (occurrences.length === 0) return [];
  const needles = uniqueNeedles([word, ...variants]);

  // Dedupe by surrounding text; keep the newest capturedAt per unique text.
  const newestBySurrounding = new Map<string, Occurrence>();
  for (const occ of occurrences) {
    const prev = newestBySurrounding.get(occ.surrounding);
    if (!prev || occ.capturedAt > prev.capturedAt) {
      newestBySurrounding.set(occ.surrounding, occ);
    }
  }
  const unique = Array.from(newestBySurrounding.values()).sort(
    (a, b) => b.capturedAt - a.capturedAt,
  );
  const top = unique.slice(0, 3);

  return top.map((occ) => {
    const windowed = occ.surrounding.slice(0, SCAN_LIMIT);
    const rawRanges = findRanges(needles, windowed);
    const { snippet, ranges } = clipSnippet(windowed, rawRanges);
    return {
      sourceTitle: occ.sourceTitle,
      sourceUrl: occ.sourceUrl,
      capturedAt: occ.capturedAt,
      snippet,
      ranges,
    };
  });
}

function findRanges(needles: string[], haystack: string): HighlightRange[] {
  if (needles.length === 0 || !haystack) return [];
  const ranges: HighlightRange[] = [];
  for (const needle of needles) {
    let from = 0;
    while (from <= haystack.length) {
      const idx = haystack.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push({ start: idx, end: idx + needle.length, text: needle });
      from = idx + needle.length;
    }
  }
  return ranges.sort((a, b) => a.start - b.start || b.end - a.end);
}

function uniqueNeedles(values: string[]): string[] {
  return Array.from(new Set(values.filter((value) => value.length > 0)));
}

const SNIPPET_RADIUS = 64;
const EMPTY_MATCH_SNIPPET = 160;

function clipSnippet(
  text: string,
  ranges: HighlightRange[],
): { snippet: string; ranges: HighlightRange[] } {
  if (text.length === 0) return { snippet: '', ranges: [] };
  if (text.length <= EMPTY_MATCH_SNIPPET) return { snippet: text, ranges };
  if (ranges.length === 0) {
    return { snippet: text.slice(0, EMPTY_MATCH_SNIPPET), ranges: [] };
  }

  const first = ranges[0];
  const start = Math.max(0, first.start - SNIPPET_RADIUS);
  const end = Math.min(text.length, first.end + SNIPPET_RADIUS);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = `${prefix}${text.slice(start, end)}${suffix}`;
  const prefixOffset = prefix.length;
  const adjusted = ranges
    .filter((range) => range.start >= start && range.end <= end)
    .map((range) => ({
      ...range,
      start: range.start - start + prefixOffset,
      end: range.end - start + prefixOffset,
    }));
  return { snippet, ranges: adjusted };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/word-insight.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/word-insight.ts tests/word-insight.test.ts
git commit -m "feat: build highlighted source examples"
```

---

## Task 9: Word insight composition (TDD)

**Files:**
- Modify: `lib/word-insight.ts` (add `computeWordInsight`)
- Create: append to `tests/word-insight.test.ts`

This is the top-level pure function that combines dictionary lookup, component fallback, tone chips, examples, and external links.

- [ ] **Step 1: Append composition tests to `tests/word-insight.test.ts`**

Append:

```ts
import { computeWordInsight } from '../lib/word-insight';
import { buildIndex } from '../lib/dictionary';
import { materializeEntries } from '../lib/dictionary';
import type { CompactDictionaryAsset, DictionaryIndex, WordEntry } from '../lib/types';

const asset: CompactDictionaryAsset = {
  meta: {
    source: 'CC-CEDICT',
    sourceUrl: '',
    release: '2026-06-20',
    license: 'CC-BY-SA 4.0',
    licenseUrl: '',
    hash: 'abc123',
    generatedAt: '2026-06-20T00:00:00.000Z',
  },
  columns: {
    simplified: ['你好', '行', '行', '龙'],
    traditional: ['你好', '行', '行', '龍'],
    pinyin: ['ni3 hao3', 'xing2', 'hang2', 'long2'],
    definitionRanges: [
      [0, 2],
      [2, 1],
      [3, 1],
      [4, 1],
    ],
    definitions: ['hello', 'good day', 'to walk', 'row', 'dragon'],
  },
};

const index: DictionaryIndex = buildIndex(materializeEntries(asset));

const word = (over: Partial<WordEntry>): WordEntry => ({
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [],
  ...over,
});

describe('computeWordInsight', () => {
  it('returns ready with exact entries, tone chips, examples, and links', () => {
    const w = word({
      text: '你好',
      occurrences: [
        {
          sourceTitle: 'A',
          sourceUrl: 'https://a.com',
          sourceDomain: 'a.com',
          surrounding: '今天 我 看到 你好 世界',
          capturedAt: 1,
        },
      ],
    });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('ready');
    expect(insight.displayText).toBe('你好');
    expect(insight.exactEntries).toHaveLength(1);
    expect(insight.exactEntries[0].pinyin).toBe('ni3 hao3');
    expect(insight.toneChips).toHaveLength(2);
    expect(insight.toneChips[0].source).toBe('dictionary');
    expect(insight.examples).toHaveLength(1);
    expect(insight.externalLinks.map((l) => l.label)).toEqual(['MDBG', '百度汉语']);
  });

  it('tries the normalized key when captured text is decorated', () => {
    const w = word({ text: '你好！', normalized: '你好' });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('ready');
    expect(insight.exactEntries[0].simplified).toBe('你好');
  });

  it('uses pinyin-pro tone chips when no exact match exists', () => {
    const w = word({ text: '不存在词', normalized: '不存在词' });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('no-definition');
    expect(insight.exactEntries).toEqual([]);
    expect(insight.toneChips[0].source).toBe('pinyin-pro');
  });

  it('runs component fallback for a multi-char word with no exact match', () => {
    const w = word({ text: '龙龙', normalized: '龙龙' });
    const insight = computeWordInsight(w, index);
    expect(insight.status).toBe('no-definition');
    expect(insight.componentEntries.map((e) => e.simplified)).toEqual(['龙', '龙']);
  });

  it('returns dictionary-unavailable status when index is null', () => {
    const w = word({ text: '你好' });
    const insight = computeWordInsight(w, null);
    expect(insight.status).toBe('dictionary-unavailable');
    expect(insight.exactEntries).toEqual([]);
    expect(insight.toneChips[0].source).toBe('pinyin-pro');
  });

  it('caps exact entries to five', () => {
    const many = buildIndex(
      Array.from({ length: 8 }, (_, i) => ({
        index: i,
        traditional: '行',
        simplified: '行',
        pinyin: `pinyin${i}`,
        definitions: [`d${i}`],
      })),
    );
    const w = word({ text: '行' });
    const insight = computeWordInsight(w, many);
    expect(insight.exactEntries.length).toBeLessThanOrEqual(5);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/word-insight.test.ts`
Expected: FAIL — `computeWordInsight` not exported.

- [ ] **Step 3: Implement composition**

Append to `lib/word-insight.ts`:

```ts

import { lookupExact, segmentComponents } from './dictionary';
import { cedictPinyinToChips, inferToneChips } from './pinyin-helpers';
import { buildExternalLinks } from './external-dictionaries';
import type { DictionaryEntry, DictionaryIndex, WordEntry, WordInsight } from './types';

const MAX_EXACT_ENTRIES = 5;

/**
 * Combine dictionary lookup, tone analysis, highlighted examples, and
 * external links into a non-persisted WordInsight.
 *
 * Pass `null` for `index` when the dictionary asset could not be loaded.
 */
export function computeWordInsight(
  word: WordEntry,
  index: DictionaryIndex | null,
): WordInsight {
  const displayText = word.text;
  const externalLinks = buildExternalLinks(displayText);

  if (index === null) {
    const examples = buildHighlightedExamples(displayText, word.occurrences);
    return {
      displayText,
      exactEntries: [],
      componentEntries: [],
      toneChips: inferToneChips(displayText),
      examples,
      externalLinks,
      status: 'dictionary-unavailable',
    };
  }

  const exactRaw = uniqueEntries([
    ...lookupExact(index, displayText),
    ...lookupExact(index, word.normalized),
  ]);
  const exactEntries = exactRaw.slice(0, MAX_EXACT_ENTRIES);
  const highlightVariants = exactEntries.flatMap((entry) => [
    entry.simplified,
    entry.traditional,
  ]);
  const examples = buildHighlightedExamples(
    displayText,
    word.occurrences,
    highlightVariants,
  );

  if (exactEntries.length > 0) {
    const primaryPinyin = exactEntries[0].pinyin;
    const toneChips = cedictPinyinToChips(primaryPinyin, displayText);
    return {
      displayText,
      exactEntries,
      componentEntries: [],
      toneChips,
      examples,
      externalLinks,
      status: 'ready',
    };
  }

  // No exact match: component fallback (single-char entries included).
  const segments = segmentComponents(index, displayText);
  const componentEntries = segments
    .map((seg) => seg.entry)
    .filter((e): e is DictionaryEntry => e !== undefined);

  return {
    displayText,
    exactEntries: [],
    componentEntries,
    toneChips: inferToneChips(displayText),
    examples,
    externalLinks,
    status: 'no-definition',
  };
}

function uniqueEntries(entries: DictionaryEntry[]): DictionaryEntry[] {
  const seen = new Set<number>();
  const out: DictionaryEntry[] = [];
  for (const entry of entries) {
    if (seen.has(entry.index)) continue;
    seen.add(entry.index);
    out.push(entry);
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/word-insight.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/word-insight.ts tests/word-insight.test.ts
git commit -m "feat: compose word insight from dictionary, tones, examples"
```

---

## Task 10: Dictionary cache (IndexedDB) (TDD)

**Files:**
- Create: `lib/dictionary-cache.ts`
- Create: `tests/dictionary-cache.test.ts`

Thin browser-bound wrapper over IndexedDB. Because the test environment uses `@webext-core/fake-browser` (which does not ship IndexedDB), the cache serializes to a JSON blob and stores it under a single key; the get/set boundary is kept pure-testable.

- [ ] **Step 1: Write the failing test**

Create `tests/dictionary-cache.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDictionaryCache, getDictionaryCache, setDictionaryCache } from '../lib/dictionary-cache';
import type { DictionaryEntry, DictionaryIndex } from '../lib/types';

const entries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['hello'] },
];

// We test the serialization boundary, not IndexedDB itself. The module exposes
// a tiny serializable shape so the boundary is pure-testable.
describe('dictionary cache serialization boundary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('serializes and deserializes an index round-trip via a fake storage backend', async () => {
    const fakeStore = new Map<string, string>();
    vi.stubGlobal('__dictCacheStore', {
      get: (k: string) => Promise.resolve(fakeStore.get(k) ?? null),
      set: (k: string, v: string) => {
        fakeStore.set(k, v);
        return Promise.resolve();
      },
      clear: (k: string) => {
        fakeStore.delete(k);
        return Promise.resolve();
      },
    });

    const index: DictionaryIndex = { byForm: new Map([['你好', entries]]), maxKeyLength: 2 };
    await setDictionaryCache('hash123', index);
    const restored = await getDictionaryCache('hash123');
    expect(restored).not.toBeNull();
    expect(restored!.byForm.get('你好')).toEqual(entries);
    expect(restored!.maxKeyLength).toBe(2);

    await clearDictionaryCache('hash123');
    expect(await getDictionaryCache('hash123')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dictionary-cache.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/dictionary-cache.ts`:

```ts
import type { DictionaryEntry, DictionaryIndex } from './types';

const DB_NAME = 'shiyu-hanzi-box';
const STORE = 'dictionary-cache';

/**
 * Minimal storage backend interface. In the dashboard this is backed by
 * IndexedDB; tests inject a fake. Keeping the boundary narrow keeps the
 * serialization logic pure and unit-testable.
 */
interface CacheBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  clear(key: string): Promise<void>;
}

function backend(): CacheBackend {
  const injected = (globalThis as { __dictCacheStore?: CacheBackend }).__dictCacheStore;
  if (injected) return injected;
  return indexedDbBackend();
}

function indexedDbBackend(): CacheBackend {
  return {
    async get(key) {
      const db = await openDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = () => resolve((req.result as string) ?? null);
        req.onerror = () => reject(req.error);
      });
    },
    async set(key, value) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async clear(key) {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
  };
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Serialized shape — `Map` does not survive JSON, so it is an array of pairs. */
interface SerializedIndex {
  v: 1;
  pairs: Array<[string, DictionaryEntry[]]>;
  maxKeyLength: number;
}

export async function getDictionaryCache(
  hash: string,
): Promise<DictionaryIndex | null> {
  const raw = await backend().get(hash);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as SerializedIndex;
    return {
      byForm: new Map(parsed.pairs),
      maxKeyLength: parsed.maxKeyLength,
    };
  } catch {
    return null;
  }
}

export async function setDictionaryCache(
  hash: string,
  index: DictionaryIndex,
): Promise<void> {
  const serialized: SerializedIndex = {
    v: 1,
    pairs: Array.from(index.byForm.entries()),
    maxKeyLength: index.maxKeyLength,
  };
  await backend().set(hash, JSON.stringify(serialized));
}

export async function clearDictionaryCache(hash: string): Promise<void> {
  await backend().clear(hash);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dictionary-cache.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dictionary-cache.ts tests/dictionary-cache.test.ts
git commit -m "feat: add IndexedDB-backed dictionary cache"
```

---

## Task 11: Dictionary loader (TDD)

**Files:**
- Create: `lib/dictionary-loader.ts`
- Create: `tests/dictionary-loader.test.ts`

Fetches the manifest + compact asset from `public/dictionaries/` via `browser.runtime.getURL`, hydrates from or rebuilds the IndexedDB cache.

- [ ] **Step 1: Write the failing test**

Create `tests/dictionary-loader.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadDictionary } from '../lib/dictionary-loader';
import type { CompactDictionaryAsset, DictionaryAssetMeta } from '../lib/types';

const meta: DictionaryAssetMeta = {
  source: 'CC-CEDICT',
  sourceUrl: '',
  release: '2026-06-20',
  license: 'CC-BY-SA 4.0',
  licenseUrl: '',
  hash: 'hash1',
  generatedAt: '2026-06-20T00:00:00.000Z',
};

const asset: CompactDictionaryAsset = {
  meta,
  columns: {
    simplified: ['你好'],
    traditional: ['你好'],
    pinyin: ['ni3 hao3'],
    definitionRanges: [[0, 1]],
    definitions: ['hello'],
  },
};

const cache = new Map<string, string>();

vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (p: string) => 'https://ext/' + p },
  },
}));

describe('loadDictionary', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    cache.clear();
    // Inject a fake cache backend used by dictionary-cache.ts.
    vi.stubGlobal('__dictCacheStore', {
      get: (k: string) => Promise.resolve(cache.get(k) ?? null),
      set: (k: string, v: string) => {
        cache.set(k, v);
        return Promise.resolve();
      },
      clear: () => Promise.resolve(),
    });
  });

  it('fetches the asset, builds the index, and caches it on first load', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (url) => {
        const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      });

    const { index, status } = await loadDictionary();
    expect(status).toBe('built');
    expect(fetchSpy).toHaveBeenCalledWith('https://ext/dictionaries/cc-cedict-manifest.json');
    expect(fetchSpy).toHaveBeenCalledWith('https://ext/dictionaries/cc-cedict.compact.json');
    expect(index!.byForm.get('你好')).toHaveLength(1);
    expect(cache.has('hash1')).toBe(true);
  });

  it('hydrates from the cache when the hash matches', async () => {
    // Seed the cache first by doing one build.
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json') ? meta : asset;
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });
    await loadDictionary();

    // Second load should hydrate from cache without fetching the compact asset
    // again — it still fetches the tiny manifest to read the hash.
    fetchSpy.mockClear();
    fetchSpy.mockResolvedValue(new Response(JSON.stringify(meta), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));

    const { index, status } = await loadDictionary();
    expect(status).toBe('cached');
    expect(index!.byForm.get('你好')).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).toHaveBeenCalledWith('https://ext/dictionaries/cc-cedict-manifest.json');
  });

  it('returns unavailable when fetch fails', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network'));
    const result = await loadDictionary();
    expect(result.index).toBeNull();
    expect(result.status).toBe('unavailable');
  });

  it('returns unavailable when manifest and compact asset hashes differ', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const body = String(url).endsWith('cc-cedict-manifest.json')
        ? meta
        : { ...asset, meta: { ...meta, hash: 'different' } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await loadDictionary();
    expect(result.index).toBeNull();
    expect(result.status).toBe('unavailable');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/dictionary-loader.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `lib/dictionary-loader.ts`:

```ts
import { browser } from 'wxt/browser';
import { buildIndex, materializeEntries } from './dictionary';
import { getDictionaryCache, setDictionaryCache } from './dictionary-cache';
import type { CompactDictionaryAsset, DictionaryAssetMeta, DictionaryIndex } from './types';

export type DictionaryLoadStatus = 'cached' | 'built' | 'unavailable';

export interface DictionaryLoadResult {
  index: DictionaryIndex | null;
  status: DictionaryLoadStatus;
  meta: DictionaryAssetMeta | null;
}

const MANIFEST_URL = 'dictionaries/cc-cedict-manifest.json';
const ASSET_URL = 'dictionaries/cc-cedict.compact.json';

/** Fetch and build (or hydrate) the dictionary index for this dashboard session. */
export async function loadDictionary(): Promise<DictionaryLoadResult> {
  const startedAt = nowMs();
  try {
    const manifest = await fetchJson<DictionaryAssetMeta>(MANIFEST_URL);
    if (!manifest) return done(unavailable(), startedAt);

    const cached = await getDictionaryCache(manifest.hash);
    if (cached) {
      return done({ index: cached, status: 'cached', meta: manifest }, startedAt);
    }

    const asset = await fetchJson<CompactDictionaryAsset>(ASSET_URL);
    if (!asset) return done(unavailable(), startedAt);
    if (asset.meta.hash !== manifest.hash) return done(unavailable(), startedAt);

    const entries = materializeEntries(asset);
    const index = buildIndex(entries);
    await setDictionaryCache(manifest.hash, index);
    return done({ index, status: 'built', meta: manifest }, startedAt);
  } catch {
    return done(unavailable(), startedAt);
  }
}

async function fetchJson<T>(path: string): Promise<T | null> {
  const url = browser.runtime.getURL(path);
  const res = await fetch(url);
  if (!res.ok) return null;
  return (await res.json()) as T;
}

function unavailable(): DictionaryLoadResult {
  return { index: null, status: 'unavailable', meta: null };
}

function done(result: DictionaryLoadResult, startedAt: number): DictionaryLoadResult {
  if (import.meta.env.DEV) {
    console.debug(
      `[dictionary-loader] status=${result.status} initMs=${Math.round(nowMs() - startedAt)}`,
    );
  }
  return result;
}

function nowMs(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/dictionary-loader.test.ts`
Expected: PASS.

- [ ] **Step 5: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add lib/dictionary-loader.ts tests/dictionary-loader.test.ts
git commit -m "feat: add dashboard dictionary loader with cache"
```

---

## Task 12: useWordInsight hook

**Files:**
- Create: `entrypoints/newtab/hooks/useWordInsight.ts`

Loads the dictionary once per dashboard session, then computes insight per word. No test for the hook itself — its behavior is covered by the pure `computeWordInsight` tests; the hook only glues loader + computation.

- [ ] **Step 1: Implement the hook**

Create `entrypoints/newtab/hooks/useWordInsight.ts`:

```ts
import { useEffect, useMemo, useState } from 'react';
import { loadDictionary } from '@/lib/dictionary-loader';
import { computeWordInsight } from '@/lib/word-insight';
import type { DictionaryIndex, WordEntry, WordInsight } from '@/lib/types';

type LoadState =
  | { phase: 'loading'; index: null }
  | { phase: 'ready'; index: DictionaryIndex | null };

let sessionLoad: Promise<LoadState> | null = null;

async function ensureLoaded(): Promise<LoadState> {
  if (!sessionLoad) {
    sessionLoad = loadDictionary().then((result) => ({
      phase: 'ready' as const,
      index: result.index,
    }));
  }
  return sessionLoad;
}

export function useWordInsight(word: WordEntry): {
  insight: WordInsight | null;
  loading: boolean;
} {
  const [state, setState] = useState<LoadState>({ phase: 'loading', index: null });

  useEffect(() => {
    let cancelled = false;
    ensureLoaded().then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const insight = useMemo(
    () => (state.phase === 'ready' ? computeWordInsight(word, state.index) : null),
    [word, state],
  );

  return { insight, loading: state.phase === 'loading' };
}
```

- [ ] **Step 2: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add entrypoints/newtab/hooks/useWordInsight.ts
git commit -m "feat: add useWordInsight dashboard hook"
```

---

## Task 13: ToneChips, DefinitionList, SourceExamples components

**Files:**
- Create: `entrypoints/newtab/components/ToneChips.tsx`
- Create: `entrypoints/newtab/components/DefinitionList.tsx`
- Create: `entrypoints/newtab/components/SourceExamples.tsx`

Presentational components following the shuimo theme conventions seen in `WordCard.tsx` (`rounded-sm`, `border-border`, `bg-paper-input`, `text-muted`, cinnabar accent).

- [ ] **Step 1: Create ToneChips**

Create `entrypoints/newtab/components/ToneChips.tsx`:

```tsx
import type { ToneChip as ToneChipData } from '@/lib/types';

const TONE_TAILWIND: Record<number, string> = {
  0: 'border-border text-muted',
  1: 'border-border text-ink',
  2: 'border-border text-ink',
  3: 'border-cinnabar-border text-cinnabar',
  4: 'border-cinnabar-border text-cinnabar',
};

export function ToneChips({ chips }: { chips: ToneChipData[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={i}
          className={`inline-flex flex-col items-center rounded-sm border bg-paper-input px-2 py-1 text-xs leading-tight ${TONE_TAILWIND[chip.tone]}`}
        >
          <span className="text-base font-semibold tracking-[1px]">{chip.text || '·'}</span>
          <span>{chip.mark}</span>
          <span className="text-[10px] text-muted">{chip.numbered}</span>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Create DefinitionList**

Create `entrypoints/newtab/components/DefinitionList.tsx`:

```tsx
import type { DictionaryEntry } from '@/lib/types';

export function DefinitionList({
  title,
  entries,
  emptyHint,
}: {
  title: string;
  entries: DictionaryEntry[];
  emptyHint?: string;
}) {
  if (entries.length === 0) {
    if (!emptyHint) return null;
    return <p className="text-xs text-muted">{emptyHint}</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-[2px] text-muted">{title}</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={entry.index} className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
            <span className="text-xs text-cinnabar">{entry.pinyin}</span>
            <ul className="mt-0.5 space-y-0.5">
              {entry.definitions.map((def, i) => (
                <li key={i} className="text-xs text-ink-secondary">{def}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create SourceExamples**

Create `entrypoints/newtab/components/SourceExamples.tsx`:

```tsx
import type { ExternalDictionaryLink, HighlightedExample } from '@/lib/types';

export function SourceExamples({
  examples,
  externalLinks,
}: {
  examples: HighlightedExample[];
  externalLinks: ExternalDictionaryLink[];
}) {
  return (
    <div className="space-y-2">
      {examples.map((ex, i) => (
        <HighlightedLine key={i} example={ex} />
      ))}
      {externalLinks.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {externalLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function HighlightedLine({ example }: { example: HighlightedExample }) {
  const parts = renderWithRanges(example.snippet, example.ranges);
  const sourceLabel = example.sourceTitle || '来源';
  return (
    <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs">
      {example.snippet ? (
        <p className="leading-5 text-ink-secondary">{parts}</p>
      ) : (
        <p className="text-muted">（无上下文）</p>
      )}
      {example.sourceUrl ? (
        <a
          href={example.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[11px] text-muted hover:text-cinnabar"
        >
          {sourceLabel} ↗
        </a>
      ) : (
        <span className="mt-1 inline-block text-[11px] text-muted">{sourceLabel}</span>
      )}
    </div>
  );
}

function renderWithRanges(snippet: string, ranges: HighlightedExample['ranges']) {
  if (ranges.length === 0) return snippet;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Array<string | { key: string; text: string }> = [];
  let cursor = 0;
  for (const range of sorted) {
    if (range.start > cursor) out.push(snippet.slice(cursor, range.start));
    out.push({ key: `h${range.start}`, text: snippet.slice(range.start, range.end) });
    cursor = range.end;
  }
  if (cursor < snippet.length) out.push(snippet.slice(cursor));
  return out.map((part, i) =>
    typeof part === 'string' ? (
      <span key={`s${i}`}>{part}</span>
    ) : (
      <mark key={part.key} className="rounded-sm bg-cinnabar/20 px-0.5 text-cinnabar">
        {part.text}
      </mark>
    ),
  );
}
```

- [ ] **Step 4: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/newtab/components/ToneChips.tsx entrypoints/newtab/components/DefinitionList.tsx entrypoints/newtab/components/SourceExamples.tsx
git commit -m "feat: add tone chips, definition list, source example components"
```

---

## Task 14: WordInsightPanel + wire into WordCard

**Files:**
- Create: `entrypoints/newtab/components/WordInsightPanel.tsx`
- Modify: `entrypoints/newtab/components/WordCard.tsx`

- [ ] **Step 1: Create the panel**

Create `entrypoints/newtab/components/WordInsightPanel.tsx`:

```tsx
import type { WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { DefinitionList } from './DefinitionList';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

/**
 * Owns the `useWordInsight` hook call so the parent `WordCard` does not call
 * a hook conditionally. The hook loads the dictionary once per dashboard
 * session, so mounting this for an expanded card is cheap after the first.
 */
export function WordInsightPanel({ word }: { word: WordEntry }) {
  const { insight, loading } = useWordInsight(word);

  if (loading) {
    return <p className="text-xs text-muted">正在翻字典…</p>;
  }
  if (!insight) return null;

  return (
    <div className="space-y-3">
      <ToneChips chips={insight.toneChips} />

      {insight.status === 'ready' && (
        <DefinitionList title="释义" entries={insight.exactEntries} />
      )}

      {insight.status === 'no-definition' && insight.componentEntries.length > 0 && (
        <DefinitionList title="单字释义" entries={insight.componentEntries} />
      )}

      {insight.status === 'no-definition' && insight.componentEntries.length === 0 && (
        <p className="text-xs text-muted">暂无本地释义，可点下方链接查询。</p>
      )}

      {insight.status === 'dictionary-unavailable' && (
        <p className="text-xs text-muted">字典暂不可用。</p>
      )}

      <SourceExamples examples={insight.examples} externalLinks={insight.externalLinks} />
      <a
        href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-[10px] text-muted hover:text-cinnabar"
      >
        Dictionary: CC-CEDICT
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Wire the panel into WordCard**

Modify `entrypoints/newtab/components/WordCard.tsx`. Replace the entire `{expanded && (...)}` block (lines 84–112) with:

```tsx
      {expanded && (
        <div className="mt-4 space-y-3 border-t border-border pt-3 text-sm">
          <WordInsightPanel word={word} />

          <details className="rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs">
            <summary className="cursor-pointer text-muted">所有相遇（{word.occurrences.length}）</summary>
            <ul className="mt-1.5 space-y-1.5">
              {word.occurrences.map((occurrence, index) => (
                <li key={index} className="truncate rounded-sm border border-border bg-paper-light px-2 py-1 text-xs text-muted">
                  <a
                    href={occurrence.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="hover:text-cinnabar"
                  >
                    {occurrence.sourceTitle || occurrence.sourceDomain}
                  </a>
                  {occurrence.surrounding && (
                    <span className="text-muted"> · {occurrence.surrounding}</span>
                  )}
                </li>
              ))}
            </ul>
          </details>

          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => note !== word.note && onUpdate({ note })}
            placeholder="写一点自己的理解..."
            className="w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-cinnabar-fade"
            rows={2}
          />
        </div>
      )}
```

Then add the import at the top of `WordCard.tsx` (after the existing `PinyinButton` import). Note: only the panel is imported — `WordInsightPanel` owns the `useWordInsight` hook, so `WordCard` itself never calls a hook and thus avoids a conditional-hook violation:

```tsx
import { WordInsightPanel } from './WordInsightPanel';
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 4: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/newtab/components/WordInsightPanel.tsx entrypoints/newtab/components/WordCard.tsx
git commit -m "feat: add word insight panel to expanded word cards"
```

---

## Task 15: Review reveal interaction

**Files:**
- Create: `entrypoints/newtab/components/ReviewInsightReveal.tsx`
- Modify: `entrypoints/newtab/components/ReviewQueue.tsx`

Before reveal: word + source label only. After reveal: pinyin, definitions (up to two examples), tone chips. Existing review actions unchanged.

- [ ] **Step 1: Create the reveal component**

Create `entrypoints/newtab/components/ReviewInsightReveal.tsx`:

```tsx
import { useState } from 'react';
import type { WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { DefinitionList } from './DefinitionList';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

export function ReviewInsightReveal({ word }: { word: WordEntry }) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
      >
        显示释义
      </button>
    );
  }

  return <RevealedReviewInsight word={word} />;
}

function RevealedReviewInsight({ word }: { word: WordEntry }) {
  const { insight, loading } = useWordInsight(word);

  if (loading || !insight) {
    return <p className="mt-3 text-xs text-muted">正在翻字典…</p>;
  }

  const topExamples = insight.examples.slice(0, 2);

  return (
    <div className="mt-3 space-y-2">
      <ToneChips chips={insight.toneChips} />
      <DefinitionList
        title="释义"
        entries={insight.exactEntries.length > 0 ? insight.exactEntries : insight.componentEntries}
      />
      {word.note && (
        <p className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {word.note}
        </p>
      )}
      <SourceExamples examples={topExamples} externalLinks={[]} />
    </div>
  );
}
```

- [ ] **Step 2: Wire it into ReviewQueue**

In `entrypoints/newtab/components/ReviewQueue.tsx`, add the import at the top:

```tsx
import { ReviewInsightReveal } from './ReviewInsightReveal';
```

In the `ReviewCard` function, immediately after the `{entry.note && (...)}` block (after line 97) and before the `<div className="mt-4 flex flex-wrap justify-end gap-2">` review-actions block, insert:

First change the note block so word notes are hidden before reveal:

```tsx
      {entry.kind === 'quote' && entry.note && (
        <p className="mt-3 rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {entry.note}
        </p>
      )}
```

Then insert:

```tsx
      {entry.kind === 'word' && <ReviewInsightReveal word={entry} />}
```

- [ ] **Step 3: Verify compile**

Run: `npm run compile`
Expected: clean.

- [ ] **Step 4: Run full tests**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add entrypoints/newtab/components/ReviewInsightReveal.tsx entrypoints/newtab/components/ReviewQueue.tsx
git commit -m "feat: add reveal interaction to review word cards"
```

---

## Task 16: Dictionary build script + assets + attribution doc

**Files:**
- Create: `scripts/build-dictionary.ts`
- Create: `docs/dictionaries/CC-CEDICT.md`
- Create: `public/dictionaries/cc-cedict-manifest.json` (tiny placeholder — real asset generated by the script)
- Modify: `package.json` (add `build:dictionary` script)
- Modify: `AGENTS.md` (document the new modules + asset strategy)

The build script reads a locally-downloaded CC-CEDICT source file (the developer downloads it manually from MDBG — never at runtime) and emits the two `public/dictionaries/` files.

- [ ] **Step 1: Create the build script**

Create `scripts/build-dictionary.ts`:

```ts
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildCompactAsset, parseCedictText } from '../lib/dictionary';
import type { CompactDictionaryAsset, DictionaryAssetMeta } from '../lib/types';

const SOURCE = process.env.CEDICT_SOURCE ?? 'cc-cedict.txt';
const OUT_DIR = 'public/dictionaries';

function main() {
  const text = readFileSync(SOURCE, 'utf8');
  const { skipped } = parseCedictText(text, { withStats: true });
  const asset: CompactDictionaryAsset = buildCompactAsset(text, {
    sourceUrl: 'https://www.mdbg.net/chinese/dictionary?page=cc-cedict',
    license: 'CC-BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
  });

  mkdirSync(OUT_DIR, { recursive: true });
  const meta: DictionaryAssetMeta = asset.meta;
  writeFileSync(join(OUT_DIR, 'cc-cedict-manifest.json'), JSON.stringify(meta, null, 2));
  writeFileSync(join(OUT_DIR, 'cc-cedict.compact.json'), JSON.stringify(asset));

  const compactBytes = JSON.stringify(asset).length;
  console.log(`[build-dictionary] release=${meta.release} hash=${meta.hash}`);
  console.log(`[build-dictionary] entries=${asset.columns.simplified.length}`);
  console.log(`[build-dictionary] skipped=${skipped}`);
  console.log(`[build-dictionary] compact.json bytes=${compactBytes}`);
  console.log(`[build-dictionary] wrote ${OUT_DIR}/cc-cedict-manifest.json and cc-cedict.compact.json`);
}

main();
```

- [ ] **Step 2: Add the npm script**

In `package.json`, add to the `"scripts"` object (after `"zip:firefox"`):

```json
    "build:dictionary": "tsx scripts/build-dictionary.ts",
```

Then install `tsx` as a dev dependency so the script can run:

```bash
npm install -D tsx
```

- [ ] **Step 3: Create a placeholder manifest**

The real manifest is generated by the script. Create `public/dictionaries/cc-cedict-manifest.json` as a placeholder so the loader has something to read during development before the first real build:

```json
{
  "source": "CC-CEDICT",
  "sourceUrl": "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
  "release": "placeholder",
  "license": "CC-BY-SA 4.0",
  "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
  "hash": "placeholder",
  "generatedAt": "2026-06-21T00:00:00.000Z"
}
```

Create a matching tiny placeholder compact asset at `public/dictionaries/cc-cedict.compact.json`:

```json
{
  "meta": {
    "source": "CC-CEDICT",
    "sourceUrl": "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
    "release": "placeholder",
    "license": "CC-BY-SA 4.0",
    "licenseUrl": "https://creativecommons.org/licenses/by-sa/4.0/",
    "hash": "placeholder",
    "generatedAt": "2026-06-21T00:00:00.000Z"
  },
  "columns": {
    "simplified": ["你好"],
    "traditional": ["你好"],
    "pinyin": ["ni3 hao3"],
    "definitionRanges": [[0, 1]],
    "definitions": ["hello"]
  }
}
```

- [ ] **Step 4: Create the attribution doc**

Create `docs/dictionaries/CC-CEDICT.md`:

```markdown
# CC-CEDICT Dictionary Asset

## Source

- **Project:** CC-CEDICT
- **Download:** https://www.mdbg.net/chinese/dictionary?page=cc-cedict
- **Wiki:** https://cc-cedict.org/wiki/
- **Release used:** see `public/dictionaries/cc-cedict-manifest.json` → `release`
- **Hash:** see the same manifest → `hash`

## License

CC-CEDICT is distributed under a Creative Commons Attribution-ShareAlike
license. The MDBG download page currently describes it as CC-BY-SA 4.0; the
CC-CEDICT wiki historically describes it under CC-BY-SA 3.0. Before any
release of this extension, re-check the current license statement on the
download page and update this file and the manifest `license` field if it has
changed.

- CC-BY-SA 4.0: https://creativecommons.org/licenses/by-sa/4.0/
- CC FAQ (ShareAlike scope): https://creativecommons.org/faq/

This is not legal advice. Treat the dictionary data as a separately licensed
collection asset: the data remains under its CC license, and the project's
source code is licensed separately. ShareAlike applies to adaptations of the
dictionary data; including the dictionary as a collection does not change the
license applicable to this project's own code.

## Attribution

The dashboard displays a "Dictionary: CC-CEDICT" line in the Word Insight
Panel and links to the MDBG download page.

## Update Instructions

1. Download the latest `cedict_ts.u8` from the MDBG download page into the
   repository root as `cc-cedict.txt`. Do **not** automate this download at
   runtime or in CI.
2. Run `CEDICT_SOURCE=cc-cedict.txt npm run build:dictionary`.
3. Inspect the printed `entries`, `compact.json bytes`, and new `hash`.
4. Commit the regenerated `public/dictionaries/*.json` files.
5. Update the `release` field in this doc if you record it here.

The dashboard loader caches the parsed index in IndexedDB keyed by the asset
hash; a new hash invalidates the cache automatically on next dashboard open.
```

- [ ] **Step 5: Verify compile + tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add scripts/build-dictionary.ts docs/dictionaries/CC-CEDICT.md public/dictionaries/ package.json package-lock.json
git commit -m "feat: add dictionary build script, placeholder assets, attribution doc"
```

---

## Task 17: Extend Markdown export with local definitions

**Files:**
- Modify: `lib/markdown.ts`
- Modify: `lib/export.ts`
- Modify: `entrypoints/newtab/components/Toolbar.tsx`
- Modify: `tests/markdown.test.ts`
- Modify: `tests/export.test.ts`

Add local dictionary lines per word showing CEDICT definitions. Because the dictionary is regenerable, definitions are **not** persisted on `WordEntry`; the dashboard export path loads the local dictionary index and passes it into the pure Markdown/export functions. If the dictionary asset is unavailable, exports still succeed without dictionary lines.

- [ ] **Step 1: Add a failing test**

Append to `tests/markdown.test.ts` (after the existing `describe('renderDay', ...)` block):

```ts
import { buildIndex } from '../lib/dictionary';
import type { DictionaryEntry } from '../lib/types';

const dictEntries: DictionaryEntry[] = [
  { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['hello', 'good day'] },
];

describe('renderDay with dictionary', () => {
  it('includes a Dictionary subsection when an index is provided', () => {
    const index = buildIndex(dictEntries);
    const md = renderDay(day, [word], [], index);
    expect(md).toContain('**你好**');
    expect(md).toContain('hello');
    expect(md).toContain('good day');
    expect(md).toContain('ni3 hao3');
  });

  it('omits the Dictionary subsection when no index is provided', () => {
    const md = renderDay(day, [word], []);
    expect(md).not.toContain('hello');
  });

  it('omits the subsection when the word has no dictionary match', () => {
    const index = buildIndex(dictEntries);
    const unmatched: WordEntry = { ...word, text: '不存在', normalized: '不存在' };
    const md = renderDay(day, [unmatched], [], index);
    expect(md).toContain('**不存在**');
    expect(md).not.toContain('  - Dictionary:');
  });

  it('uses the normalized key when exported word text has punctuation', () => {
    const index = buildIndex(dictEntries);
    const decorated: WordEntry = { ...word, text: '你好！', normalized: '你好' };
    const md = renderDay(day, [decorated], [], index);
    expect(md).toContain('Dictionary: _ni3 hao3_ hello; good day');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL — `renderDay` does not accept a fourth argument.

- [ ] **Step 3: Implement `renderDay` dictionary support**

In `lib/markdown.ts`, replace the `renderDay` function signature and body. Change the signature from:

```ts
export function renderDay(date: string, words: WordEntry[], quotes: QuoteEntry[]): string {
```

to:

```ts
import { lookupExact } from './dictionary';
import type { DictionaryIndex } from './types';

export function renderDay(
  date: string,
  words: WordEntry[],
  quotes: QuoteEntry[],
  index?: DictionaryIndex | null,
): string {
```

Then inside the `for (const word of words)` loop, immediately after the occurrence links loop (`for (const occurrence of word.occurrences) { ... }`), add:

```ts
      if (index) {
        const entries = dictionaryEntriesForWord(index, word).slice(0, 3);
        for (const entry of entries) {
          lines.push(`  - Dictionary: _${esc(entry.pinyin)}_ ${entry.definitions.map((d) => esc(d)).join('; ')}`);
        }
      }
```

Then add these helpers at the end of `lib/markdown.ts`:

```ts
function dictionaryEntriesForWord(index: DictionaryIndex, word: WordEntry) {
  return uniqueDictionaryEntries([
    ...lookupExact(index, word.text),
    ...lookupExact(index, word.normalized),
  ]);
}

function uniqueDictionaryEntries(entries: ReturnType<typeof lookupExact>) {
  const seen = new Set<number>();
  return entries.filter((entry) => {
    if (seen.has(entry.index)) return false;
    seen.add(entry.index);
    return true;
  });
}
```

- [ ] **Step 4: Pass the optional dictionary index through `lib/export.ts`**

Modify `lib/export.ts`:

```ts
import { zip } from 'fflate';
import { groupByDay, renderDay } from './markdown';
import type { DictionaryIndex, Inbox, QuoteEntry, WordEntry } from './types';

interface DayBucket {
  words: WordEntry[];
  quotes: QuoteEntry[];
}

export function buildExportMap(
  words: WordEntry[],
  quotes: QuoteEntry[],
  index?: DictionaryIndex | null,
): Map<string, string> {
  const buckets = new Map<string, DayBucket>();

  function touch(date: string): DayBucket {
    const existing = buckets.get(date);
    if (existing) return existing;

    const bucket = { words: [], quotes: [] };
    buckets.set(date, bucket);
    return bucket;
  }

  for (const word of words) {
    if (word.status === 'archived') continue;
    const date = groupByDay(word.occurrences[0]?.capturedAt ?? word.createdAt);
    touch(date).words.push(word);
  }

  for (const quote of quotes) {
    if (quote.status === 'archived') continue;
    const date = groupByDay(quote.createdAt);
    touch(date).quotes.push(quote);
  }

  const files = new Map<string, string>();
  for (const [date, bucket] of buckets) {
    files.set(`daily/${date}.md`, renderDay(date, bucket.words, bucket.quotes, index));
  }
  return files;
}

export async function zipBytes(files: Map<string, string>): Promise<Uint8Array> {
  const zipInput: Record<string, Uint8Array> = {};
  for (const [path, content] of files) {
    zipInput[path] = new TextEncoder().encode(content);
  }

  return new Promise((resolve, reject) => {
    zip(zipInput, (err, data) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

export async function exportInboxAsZip(
  inbox: Inbox,
  index?: DictionaryIndex | null,
): Promise<Uint8Array> {
  return zipBytes(buildExportMap(inbox.words, inbox.quotes, index));
}
```

- [ ] **Step 5: Add an export-map test**

Append to `tests/export.test.ts`:

```ts
import { buildIndex } from '../lib/dictionary';
import type { DictionaryEntry } from '../lib/types';

describe('buildExportMap with dictionary', () => {
  it('passes dictionary definitions into daily markdown files', () => {
    const entries: DictionaryEntry[] = [
      {
        index: 0,
        traditional: '你好',
        simplified: '你好',
        pinyin: 'ni3 hao3',
        definitions: ['hello'],
      },
    ];
    const map = buildExportMap([word], [], buildIndex(entries));
    expect(map.get('daily/2026-06-20.md')).toContain('Dictionary: _ni3 hao3_ hello');
  });
});
```

- [ ] **Step 6: Wire dashboard exports to the local dictionary loader**

In `entrypoints/newtab/components/Toolbar.tsx`, add the loader import:

```ts
import { loadDictionary } from '@/lib/dictionary-loader';
```

Then add this helper inside `Toolbar`, near `downloadBlob`:

```ts
  async function dictionaryIndexForExport() {
    const result = await loadDictionary();
    return result.index;
  }
```

Replace the zip and today export functions with:

```ts
  async function downloadZip() {
    const index = await dictionaryIndexForExport();
    const bytes = await exportInboxAsZip(inbox, index);
    const blob = new Blob([toArrayBuffer(bytes)], { type: 'application/zip' });
    await downloadBlob(blob, 'shiyu-hanzi-box-export.zip');
  }

  async function downloadToday() {
    const today = new Date();
    const date = [
      today.getFullYear(),
      String(today.getMonth() + 1).padStart(2, '0'),
      String(today.getDate()).padStart(2, '0'),
    ].join('-');
    const index = await dictionaryIndexForExport();
    const map = buildExportMap(inbox.words, inbox.quotes, index);
    const md = map.get(`daily/${date}.md`) ?? `# ${date}\n\n_No entries today._\n`;
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    await downloadBlob(blob, `${date}.md`);
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS.

Run: `npx vitest run tests/export.test.ts`
Expected: PASS.

- [ ] **Step 8: Run compile + full tests**

Run: `npm run compile && npm test`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add lib/markdown.ts lib/export.ts entrypoints/newtab/components/Toolbar.tsx tests/markdown.test.ts tests/export.test.ts
git commit -m "feat: include local dictionary definitions in markdown export"
```

---

## Task 18: Update AGENTS.md architecture notes

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Read the current Architecture section**

Run: `cat AGENTS.md`
Locate the "## Architecture" section and its "Core modules" list.

- [ ] **Step 2: Add the new modules**

In `AGENTS.md`, in the "Core modules" list (after the `- lib/pinyin.ts: ...` entry), add:

```markdown
- `lib/pinyin-helpers.ts`: CC-CEDICT numbered pinyin → tone marks/numbers, and
  pinyin-pro fallback for tone chips when no dictionary match exists.
- `lib/dictionary.ts`: CC-CEDICT parsing, compact asset build/materialize,
  lookup index, exact lookup, and component fallback segmentation.
- `lib/dictionary-cache.ts`: IndexedDB-backed cache for the parsed index,
  keyed by the asset hash.
- `lib/dictionary-loader.ts`: dashboard-only fetch + cache hydrate/build for
  the compact asset under `public/dictionaries/`.
- `lib/word-insight.ts`: pure composition of dictionary, tone chips, source
  examples, and external links into a `WordInsight`.
- `lib/external-dictionaries.ts`: click-only encoded MDBG and 百度汉语 URLs.
- `entrypoints/newtab/components/WordInsightPanel.tsx`: insight UI inside
  `WordCard`.
- `entrypoints/newtab/components/ReviewInsightReveal.tsx`: reveal interaction
  in `ReviewQueue`.
- `entrypoints/newtab/hooks/useWordInsight.ts`: loads the dictionary once per
  dashboard session and computes insight per word.
```

In the central data path section, after step 7 (`lib/markdown.ts` and `lib/export.ts`), add:

```markdown
8. `lib/dictionary.ts`, `lib/dictionary-loader.ts`, and `lib/word-insight.ts`
   add an offline Word Insight Panel: definitions, tone chips, highlighted
   source examples, and external dictionary links — all computed at view time,
   not persisted on `WordEntry`.
```

- [ ] **Step 3: Add the build script command**

In the "## Commands" section, after the focused-tests list, add:

```bash
npm run build:dictionary
```

with a one-line note: "Regenerate the CC-CEDICT compact asset under `public/dictionaries/`. Requires a manually-downloaded `cc-cedict.txt`; see `docs/dictionaries/CC-CEDICT.md`."

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs: document word insight modules in AGENTS.md"
```

---

## Task 19: Update README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Read the current README**

Run: `cat README.md`

- [ ] **Step 2: Add a Word Insight Panel section**

Add a new section after the existing feature list. Use this content (adapt headings to match the README's existing style):

```markdown
## Word Insight Panel

Expanding a saved word in the dashboard shows:

- **Tone chips** — one per Chinese character, with tone marks and numbers.
- **Definitions** — from the bundled CC-CEDICT offline dictionary.
- **Component fallback** — for phrases with no exact match, definitions for
  the component characters.
- **Source examples** — the captured surrounding sentences with the word
  highlighted, deduped to the newest three.
- **External links** — click-only links to MDBG (Chinese-English) and
  百度汉语 (Chinese-Chinese). Nothing is fetched until you click.

Review cards gain a **显示释义** reveal button so you can test yourself before
seeing pinyin and definitions.

### Dictionary attribution

Definitions come from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict),
licensed CC-BY-SA. See `docs/dictionaries/CC-CEDICT.md` for details and update
instructions. The dictionary ships as a compact offline asset; the extension
never contacts MDBG at runtime.

### Privacy

The Word Insight Panel is fully offline. The only outbound requests are the
two external dictionary links, and only when you click them.
```

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document word insight panel and dictionary attribution"
```

---

## Task 20: Final verification

**Files:** none.

- [ ] **Step 1: Run compile**

Run: `npm run compile`
Expected: no errors.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 3: Run build and inspect manifest**

Run: `npm run build && cat .output/chrome-mv3/manifest.json`
Expected: build succeeds; manifest retains `contextMenus`, `storage`, `activeTab`, `scripting`, `downloads`, `unlimitedStorage`, `clipboardRead`, command shortcuts, popup, and new-tab override. No new permissions added in this local-only plan; the AI layer and `optional_host_permissions` require a separate follow-up plan.

- [ ] **Step 4: Manual dashboard check**

Run: `npm run dev`
Then in the dashboard, expand a word that has an exact dictionary match, one with no match (component fallback), one with multiple occurrences, and one with empty surrounding. Confirm tone chips, definitions, source examples, and external links all render correctly and nothing makes a network request. In the dev console, record `[dictionary-loader] status=... initMs=...`; first build should target under 1,500 ms and cached loads under 150 ms on the development machine.

- [ ] **Step 5: Confirm no uncommitted changes**

Run: `git status --short`
Expected: empty.
