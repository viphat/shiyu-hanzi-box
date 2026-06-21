# Settings, Locale, And Runtime Kaikki Dictionary Design

## Summary

Add a settings page for two user-controlled preferences:

1. UI locale, selectable between English and Simplified Chinese (`zh-CN`).
2. An optional runtime Kaikki dictionary source that extends the bundled
   CC-CEDICT lookup without increasing the packed extension size.

Also replace the current MDBG external lookup button with a Youdao lookup URL.

The extension remains local-first. CC-CEDICT stays the default bundled
dictionary and is enough for normal use. Kaikki is an opt-in extension source
that the user downloads or imports into local browser storage after install.

## Goals

- Replace outbound MDBG word lookup links with Youdao:
  `https://www.youdao.com/result?word=<encoded word>&lang=en`.
- Add a settings page reachable from the new-tab dashboard.
- Persist a user-selected UI locale in `chrome.storage.local`.
- Render dashboard and settings UI labels in either English or `zh-CN`.
- Let the user enable, disable, import, download, and remove a Kaikki dictionary
  extension source at runtime.
- Store processed Kaikki entries in IndexedDB, not in the extension bundle and
  not in persisted `WordEntry` records.
- Keep CC-CEDICT as the primary dictionary. Use Kaikki to fill gaps when
  CC-CEDICT has no exact match or no component match.
- Keep dictionary lookup local after a successful import or download.

## Non-Goals

- Do not bundle a Kaikki dump in `public/` or the packed extension.
- Do not fetch Youdao, Baidu, MDBG, or any external dictionary page
  automatically. External lookup remains click-only.
- Do not translate saved user notes, captured words, quotes, Markdown exports,
  or backup content when the UI locale changes.
- Do not add AI, remote definitions, or background dictionary sync.
- Do not support arbitrary remote dump hosts in the first implementation.
  Download should target Kaikki-hosted data so the extension can use a narrow
  optional host permission.
- Do not persist dictionary definitions onto `WordEntry`.

## Current Context

The current dictionary path is:

- `public/dictionaries/cc-cedict-manifest.json` and
  `public/dictionaries/cc-cedict.compact.json` ship with the extension.
- `lib/dictionary-loader.ts` fetches those packaged files through
  `browser.runtime.getURL`.
- `lib/dictionary-cache.ts` stores the parsed CC-CEDICT index in IndexedDB by
  asset hash.
- `lib/dictionary.ts` builds a `DictionaryIndex` and performs exact and
  component fallback lookup.
- `lib/word-insight.ts` composes exact definitions, component fallback, tone
  chips, examples, and external links.
- `entrypoints/newtab/` hardcodes most visible UI strings in `zh-CN`.

This design keeps the existing default path intact and adds a second optional
runtime index beside it.

## Kaikki Source Shape

Use Kaikki JSONL as a user-managed extension source. The preferred source is
the Kaikki Chinese dictionary JSONL from the English Wiktionary edition, because
it contains Chinese entries with English glosses. Kaikki's current Chinese
dictionary page lists about 302,683 distinct word forms and a postprocessed
Chinese dictionary JSONL download of about 1.1GB. Kaikki also publishes raw
Wiktextract JSONL data and compressed raw dumps, but those are larger and less
targeted for this extension.

Implementation should support two intake paths:

- **Import local file:** user selects a `.jsonl` file from disk. This is the
  most reliable path and does not require host permissions.
- **Download from Kaikki:** user clicks a settings action that requests optional
  host permission for `https://kaikki.org/*`, streams the Kaikki JSONL, converts
  it, and stores only the compact processed entries.

If the remote Kaikki URL changes, the settings UI should allow editing the
Kaikki URL as long as it remains under `https://kaikki.org/`. Unsupported hosts
should be rejected with a clear message and the local-file import should remain
available.

## Runtime Storage Model

Add a settings storage item:

```ts
export type UiLocale = 'en' | 'zh-CN';

export interface AppSettings {
  uiLocale: UiLocale;
  kaikki: {
    enabled: boolean;
    sourceUrl: string;
    sourceName: string;
    hash: string | null;
    entryCount: number;
    importedAt: number | null;
  };
}
```

Store Kaikki dictionary data in IndexedDB, separate from `chrome.storage.local`.
The settings object stores metadata only. The data store should be keyed by the
Kaikki hash so the user can remove or replace the optional index without
touching the bundled CC-CEDICT cache.

The processed runtime entries should reuse the existing runtime dictionary
shape:

```ts
interface DictionaryEntry {
  index: number;
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
}
```

The persisted/indexed Kaikki entries should not need a new shape. Source
labeling can happen after load through a non-persisted wrapper:

```ts
type DictionarySourceId = 'cc-cedict' | 'kaikki';

interface SourcedDictionaryEntry {
  source: DictionarySourceId;
  entry: DictionaryEntry;
}
```

Kaikki records do not always have both simplified and traditional forms or
numbered pinyin. The parser should:

- accept records whose `lang_code` is `zh` or whose language is Chinese;
- use the record `word` as the primary surface form;
- gather definitions from `senses[].glosses`;
- gather pinyin from romanization or pronunciation fields when available;
- leave `pinyin` empty when no reliable pinyin exists, allowing tone chips to
  fall back to `pinyin-pro`;
- skip entries without a Chinese surface form or without usable definitions;
- dedupe repeated definitions for the same surface.

## Dictionary Lookup Behavior

Load order:

1. Load bundled CC-CEDICT exactly as today.
2. If Kaikki is enabled and a processed Kaikki hash exists, load its IndexedDB
   index.
3. Build a combined dictionary source object for word insight and exports.

Lookup priority:

- Exact lookup returns CC-CEDICT entries first.
- If CC-CEDICT has no exact entries, return Kaikki exact entries.
- Component fallback uses CC-CEDICT first for each segment.
- Kaikki component fallback is allowed only when CC-CEDICT has no match for the
  segment, so common words keep the cleaner CC-CEDICT output.
- If both sources are unavailable, the current `dictionary-unavailable` status
  remains valid.

The UI should label Kaikki-sourced entries clearly enough that users understand
they came from the optional runtime source. The initial implementation can add a
compact source label to definition sections using the non-persisted source
wrapper rather than changing the stored entry shape.

## Settings Page

Create a WXT settings entrypoint, for example `entrypoints/settings/`, and add a
settings button in the dashboard toolbar or header. The settings page should
reuse the current paper/cinnabar visual system.

Settings sections:

- **Language:** segmented control or select for `English` and `简体中文`.
- **Default dictionary:** read-only CC-CEDICT status and attribution.
- **Kaikki extension dictionary:** enabled toggle, local JSONL import, Kaikki
  download action, source URL field constrained to `https://kaikki.org/`, entry
  count, imported timestamp, and remove action.

The Kaikki import/download action should be explicit and long-running. It should
show progress states for reading, parsing, writing, complete, and failed. A
failed import must keep the previously imported Kaikki index intact.

## Locale Design

Add a small i18n module with:

```ts
export type MessageKey = keyof typeof messages.en;
export function t(locale: UiLocale, key: MessageKey): string;
```

Use this module in the dashboard, settings page, toolbar, word insight panel,
source examples, review labels, and popup where practical. The first pass should
cover user-facing UI strings visible in the normal capture/review/settings
workflow. Dates should format with the selected locale.

The popup can use the same settings hook, but if settings are still loading it
should render `zh-CN` by default to preserve current behavior.

## Permissions

The manifest should add only a narrow optional host permission for Kaikki:

```ts
optional_host_permissions: ['https://kaikki.org/*']
```

The extension should request this permission only when the user clicks the
Kaikki download action. Local file import requires no new permission.

## Error Handling

- Invalid JSONL line: count and skip the line; fail only if no usable entries
  remain.
- Empty or unsupported dump: show a clear "No usable Chinese entries found"
  message.
- Download denied: keep settings unchanged and explain that local import still
  works.
- Download/network failure: keep the previous Kaikki index and show the failure.
- IndexedDB write failure: keep settings metadata unchanged.
- Kaikki disabled: leave the stored index in place but do not load it.
- Kaikki removed: delete the Kaikki index and reset metadata.

## Testing

Use TDD for behavior changes.

Focused tests:

- `tests/external-dictionaries.test.ts`: Youdao URL, label, encoding, stable
  order with Baidu second.
- `tests/settings.test.ts`: default settings, saving locale, Kaikki metadata
  updates, reset/remove behavior.
- `tests/i18n.test.ts`: English and `zh-CN` message lookup and fallback.
- `tests/kaikki.test.ts`: JSONL parsing, skipped invalid lines, gloss
  extraction, duplicate merging, empty pinyin behavior.
- `tests/kaikki-cache.test.ts`: IndexedDB serialization round trip for the
  runtime Kaikki index.
- `tests/dictionary-loader.test.ts`: merged loader behavior, CC-CEDICT priority,
  Kaikki fallback when CC-CEDICT misses, disabled Kaikki ignored.
- `tests/word-insight.test.ts`: insight uses Kaikki fallback and still uses
  pinyin-pro when Kaikki has no pinyin.

Before claiming completion, run:

```bash
npm run compile
npm test
```

For manifest/page changes, also run:

```bash
npm run build
cat .output/chrome-mv3/manifest.json
```

## Documentation

Update the README or dictionary docs with:

- CC-CEDICT remains the default bundled dictionary.
- Kaikki is optional, user-initiated, runtime-stored, and removable.
- Importing/downloading Kaikki may require significant time and local storage.
- The extension stores processed Kaikki dictionary data locally and does not add
  it to the packed extension.
- Kaikki/Wiktextract attribution and source links.
