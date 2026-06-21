# Settings, Locale, And Runtime Kaikki Dictionary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a settings page with EN/zh-CN UI locale selection, replace MDBG with Youdao, and let users import or download an optional Kaikki JSONL dictionary into local runtime storage.

**Architecture:** Keep CC-CEDICT as the packaged default dictionary. Add small settings/i18n modules backed by `chrome.storage.local`, and a separate Kaikki parser/cache backed by IndexedDB. The dictionary loader merges CC-CEDICT first and Kaikki as fallback, while UI strings read from the selected locale.

**Tech Stack:** WXT MV3, React, TypeScript, Vitest, WXT storage, IndexedDB, existing dictionary/index modules.

---

## File Structure

- Modify `lib/types.ts`: add settings, locale, dictionary source, and optional source metadata types.
- Modify `lib/external-dictionaries.ts`: replace MDBG with Youdao.
- Create `lib/settings.ts`: storage item, defaults, setters, Kaikki metadata helpers.
- Create `lib/i18n.ts`: message table and `t(locale, key)` helper.
- Create `lib/kaikki.ts`: JSONL parser and Kaikki URL validation.
- Create `lib/kaikki-cache.ts`: IndexedDB persistence for the optional Kaikki index.
- Modify `lib/dictionary.ts`: support runtime entry source labels and merged fallback indexes.
- Modify `lib/dictionary-loader.ts`: load CC-CEDICT plus enabled Kaikki fallback.
- Modify `lib/word-insight.ts`: accept merged/source-aware indexes and handle empty Kaikki pinyin.
- Add `entrypoints/newtab/hooks/useSettings.ts`: live settings hook for the dashboard and settings page.
- Add `entrypoints/settings/index.html`, `entrypoints/settings/main.tsx`, and `entrypoints/settings/SettingsApp.tsx`: settings UI.
- Modify `entrypoints/newtab/App.tsx`, `Toolbar.tsx`, `WordInsightPanel.tsx`, `DefinitionList.tsx`, `SourceExamples.tsx`, `ReviewQueue.tsx`, `ReviewInsightReveal.tsx`, `WordCard.tsx`, `WordList.tsx`, `QuoteCard.tsx`, `QuoteList.tsx`, and `PinyinButton.tsx`: localize visible labels and add settings navigation.
- Modify `entrypoints/popup/Popup.tsx`: use locale where practical, defaulting to zh-CN while loading.
- Modify `wxt.config.ts`: add `optional_host_permissions: ['https://kaikki.org/*']`.
- Add tests: `tests/settings.test.ts`, `tests/i18n.test.ts`, `tests/kaikki.test.ts`, `tests/kaikki-cache.test.ts`.
- Modify tests: `tests/external-dictionaries.test.ts`, `tests/dictionary-loader.test.ts`, `tests/word-insight.test.ts`.
- Update docs: `README.md` or `docs/dictionaries/CC-CEDICT.md`.

## Task 1: Replace MDBG With Youdao

**Files:**
- Modify: `tests/external-dictionaries.test.ts`
- Modify: `lib/external-dictionaries.ts`
- Modify: `lib/types.ts`
- Modify: `tests/word-insight.test.ts`

- [ ] **Step 1: Write failing tests**

Update the external dictionary tests to expect:

```ts
expect(youdao.url).toBe(
  'https://www.youdao.com/result?word=' + encodeURIComponent('你好') + '&lang=en',
);
expect(links.map((l) => l.label)).toEqual(['Youdao', '百度汉语']);
```

Update the word insight link-label assertion:

```ts
expect(insight.externalLinks.map((l) => l.label)).toEqual(['Youdao', '百度汉语']);
```

- [ ] **Step 2: Run red tests**

Run: `npx vitest run tests/external-dictionaries.test.ts tests/word-insight.test.ts`

Expected: failures still mention `MDBG`.

- [ ] **Step 3: Implement minimal link change**

Change `ExternalDictionaryLink['label']` to include `Youdao` instead of `MDBG`, and return:

```ts
{
  label: 'Youdao',
  language: 'Chinese-English',
  url: `https://www.youdao.com/result?word=${q}&lang=en`,
}
```

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/external-dictionaries.test.ts tests/word-insight.test.ts`

Expected: both focused tests pass.

## Task 2: Settings Storage And I18n

**Files:**
- Create: `tests/settings.test.ts`
- Create: `tests/i18n.test.ts`
- Create: `lib/settings.ts`
- Create: `lib/i18n.ts`
- Modify: `lib/types.ts`

- [ ] **Step 1: Write failing settings tests**

Cover default locale and Kaikki metadata updates:

```ts
expect(defaultSettings.uiLocale).toBe('zh-CN');
expect(setUiLocale(defaultSettings, 'en').uiLocale).toBe('en');
expect(enableKaikki(defaultSettings, true).kaikki.enabled).toBe(true);
expect(recordKaikkiImport(defaultSettings, {
  sourceUrl: 'https://kaikki.org/dictionary/Chinese/kaikki.org-dictionary-Chinese.jsonl',
  sourceName: 'Kaikki Chinese',
  hash: 'abc',
  entryCount: 2,
  importedAt: 100,
}).kaikki.hash).toBe('abc');
expect(resetKaikki(defaultSettings).kaikki.hash).toBeNull();
```

- [ ] **Step 2: Write failing i18n tests**

Cover message lookup:

```ts
expect(t('en', 'settings.title')).toBe('Settings');
expect(t('zh-CN', 'settings.title')).toBe('设置');
expect(t('en', 'dictionary.kaikki')).toBe('Kaikki extension dictionary');
```

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/settings.test.ts tests/i18n.test.ts`

Expected: module-not-found failures.

- [ ] **Step 4: Implement settings and i18n modules**

Add `UiLocale`, `AppSettings`, `DEFAULT_SETTINGS`, `settingsStorage`, `setUiLocale`, `enableKaikki`, `recordKaikkiImport`, and `resetKaikki`. Add a flat message table with keys used by dashboard, popup, settings, and insight components.

- [ ] **Step 5: Verify green**

Run: `npx vitest run tests/settings.test.ts tests/i18n.test.ts`

Expected: tests pass.

## Task 3: Kaikki Parser

**Files:**
- Create: `tests/kaikki.test.ts`
- Create: `lib/kaikki.ts`

- [ ] **Step 1: Write failing parser tests**

Use JSONL fixtures inline:

```ts
const jsonl = [
  JSON.stringify({
    word: '滞胀',
    lang_code: 'zh',
    lang: 'Chinese',
    sounds: [{ roman: 'zhìzhàng' }],
    senses: [{ glosses: ['stagflation'] }],
  }),
  '{bad json',
  JSON.stringify({ word: 'hello', lang_code: 'en', senses: [{ glosses: ['hi'] }] }),
].join('\n');

const result = parseKaikkiJsonl(jsonl);
expect(result.entries).toHaveLength(1);
expect(result.entries[0].simplified).toBe('滞胀');
expect(result.entries[0].definitions).toEqual(['stagflation']);
expect(result.skipped).toBe(2);
```

Also test duplicate gloss merging and `isAllowedKaikkiUrl('https://kaikki.org/...')`.

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/kaikki.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement parser**

Parse line by line, accept Chinese records, gather `senses[].glosses`, gather pinyin from `sounds[].roman`, `sounds[].pinyin`, `sounds[].zh_pron`, or `sounds[]['zh-pron']`, skip invalid/unsupported lines, dedupe definitions per surface, and return `DictionaryEntry[]`.

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/kaikki.test.ts`

Expected: tests pass.

## Task 4: Runtime Kaikki Cache

**Files:**
- Create: `tests/kaikki-cache.test.ts`
- Create: `lib/kaikki-cache.ts`

- [ ] **Step 1: Write failing cache tests**

Mirror the fake backend pattern from `tests/dictionary-cache.test.ts`:

```ts
const index = buildIndex([{ index: 0, simplified: '滞胀', traditional: '滯脹', pinyin: '', definitions: ['stagflation'] }]);
await setKaikkiCache('hash', index);
expect((await getKaikkiCache('hash'))!.byForm.get('滞胀')).toHaveLength(1);
await clearKaikkiCache('hash');
expect(await getKaikkiCache('hash')).toBeNull();
```

- [ ] **Step 2: Run red test**

Run: `npx vitest run tests/kaikki-cache.test.ts`

Expected: module-not-found failure.

- [ ] **Step 3: Implement cache**

Use IndexedDB database `shiyu-hanzi-box`, object store `kaikki-cache`, and the same JSON serialization shape as `dictionary-cache.ts`. Support injected test backend via `globalThis.__kaikkiCacheStore`.

- [ ] **Step 4: Verify green**

Run: `npx vitest run tests/kaikki-cache.test.ts`

Expected: tests pass.

## Task 5: Merge CC-CEDICT And Kaikki In Loader

**Files:**
- Modify: `tests/dictionary-loader.test.ts`
- Modify: `tests/word-insight.test.ts`
- Modify: `lib/types.ts`
- Modify: `lib/dictionary.ts`
- Modify: `lib/dictionary-loader.ts`
- Modify: `lib/word-insight.ts`

- [ ] **Step 1: Write failing loader tests**

Stub `settingsStorage.getValue()` to return enabled Kaikki metadata and inject a Kaikki cache entry. Assert a CC-CEDICT hit wins when both dictionaries contain the word, and a Kaikki hit appears when CC-CEDICT misses.

- [ ] **Step 2: Write failing word insight test**

Build an index where CC-CEDICT misses `滞胀` and Kaikki has it, then assert `computeWordInsight` returns `ready` with the Kaikki definition and pinyin-pro tone chips when pinyin is empty.

- [ ] **Step 3: Run red tests**

Run: `npx vitest run tests/dictionary-loader.test.ts tests/word-insight.test.ts`

Expected: Kaikki assertions fail.

- [ ] **Step 4: Implement merged index**

Add optional runtime source metadata while keeping stored entries compatible:

```ts
export type DictionarySourceId = 'cc-cedict' | 'kaikki';
export interface DictionaryEntry {
  index: number;
  traditional: string;
  simplified: string;
  pinyin: string;
  definitions: string[];
  source?: DictionarySourceId;
}
```

Add helper functions to clone entries with source labels and merge fallback indexes. Loader should read settings, load Kaikki cache only when enabled/hash exists, and return the merged index.

- [ ] **Step 5: Handle empty pinyin in word insight**

If a primary exact entry has no pinyin, call `inferToneChips(displayText)` instead of `cedictPinyinToChips`.

- [ ] **Step 6: Verify green**

Run: `npx vitest run tests/dictionary-loader.test.ts tests/word-insight.test.ts`

Expected: tests pass.

## Task 6: Settings Page And Locale Hook

**Files:**
- Create: `entrypoints/newtab/hooks/useSettings.ts`
- Create: `entrypoints/settings/index.html`
- Create: `entrypoints/settings/main.tsx`
- Create: `entrypoints/settings/SettingsApp.tsx`
- Modify: `wxt.config.ts`
- Modify: `entrypoints/newtab/components/Toolbar.tsx`

- [ ] **Step 1: Implement hook and page shell**

Create a React settings page that loads `settingsStorage`, offers locale select, Kaikki enable toggle, source URL input, local file input, download button, remove button, and status text.

- [ ] **Step 2: Implement import/download handlers**

Local import reads `file.text()`, parses with `parseKaikkiJsonl`, stores `buildIndex(entries)` through `setKaikkiCache(hash, index)`, then records metadata. Download validates `https://kaikki.org/`, requests optional permission, fetches text, and follows the same import path.

- [ ] **Step 3: Add dashboard navigation**

Add a settings button to `Toolbar` that opens `browser.runtime.getURL('settings.html')`.

- [ ] **Step 4: Add optional host permission**

Add:

```ts
optional_host_permissions: ['https://kaikki.org/*'],
```

- [ ] **Step 5: Compile-check page wiring**

Run: `npm run compile`

Expected: TypeScript passes or reports only issues introduced by this task.

## Task 7: Localize Visible UI

**Files:**
- Modify dashboard, popup, and insight components listed in File Structure.

- [ ] **Step 1: Pass locale/messages down from `App`**

Use `useSettings()` in `App`, format the date with `settings.uiLocale`, and pass `locale` into child components.

- [ ] **Step 2: Replace hardcoded normal-workflow strings**

Use `t(locale, key)` for dashboard tabs, filters, toolbar, empty states, action titles, insight loading/empty states, popup capture actions, and settings labels.

- [ ] **Step 3: Keep user content unchanged**

Do not translate captured text, notes, quote categories, source titles, export content, or backup content.

- [ ] **Step 4: Compile-check localization**

Run: `npm run compile`

Expected: TypeScript passes.

## Task 8: Docs And Full Verification

**Files:**
- Modify: `README.md` or `docs/dictionaries/CC-CEDICT.md`

- [ ] **Step 1: Document runtime Kaikki**

Add a short section explaining CC-CEDICT default behavior, optional Kaikki import/download, local storage, storage cost, and Kaikki/Wiktextract attribution.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npx vitest run tests/external-dictionaries.test.ts tests/settings.test.ts tests/i18n.test.ts tests/kaikki.test.ts tests/kaikki-cache.test.ts tests/dictionary-loader.test.ts tests/word-insight.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 3: Run required project verification**

Run:

```bash
npm run compile
npm test
npm run build
cat .output/chrome-mv3/manifest.json
```

Expected: compile, tests, and build pass; manifest includes existing permissions plus optional Kaikki host permission, popup, new-tab override, settings page assets, background service worker, and commands.
