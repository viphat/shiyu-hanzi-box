# CVDICT + Vietnamese AI Word Insights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Release v0.4.5 with optional locally installed CVDICT Chinese-Vietnamese definitions and independent explicit-click Vietnamese AI Word Insights.

**Architecture:** A Settings gesture grants one optional raw-GitHub origin, then a module worker streams CVDICT into a shared IndexedDB cache. The loader returns separate English and Vietnamese indexes. The existing AI transport gets language-specific prompts and an atomic background patch protocol so English and Vietnamese outputs remain independent locally and through sync.

**Tech Stack:** TypeScript, React 19, WXT 0.20.26 MV3, Vitest 4, @webext-core/fake-browser, IndexedDB, existing pinyin-pro, and existing OpenAI-compatible BYO-key providers.

## Global Constraints

- Target version is exactly 0.4.5 in package.json and the root package-lock metadata.
- CVDICT source is exactly https://raw.githubusercontent.com/ph0ngp/CVDICT/main/CVDICT.u8. Do not add a configurable source URL.
- Download is explicit-click only, has a 25 MiB ceiling, runs in a worker, and requests https://raw.githubusercontent.com/* only as an optional host permission.
- CVDICT remains local IndexedDB data. Never store the index in chrome.storage.local, sync replicas, or exports.
- aiInsight remains English; aiVietnameseInsight is Vietnamese. A request/failure for one never mutates the other.
- Every AI network request is an explicit user click and requests provider permission before fetch.
- Keep user-facing text in both i18n tables. No locale ternaries in entrypoints.
- Preserve the existing untracked test-debug.mjs. Never stage, edit, or delete it.
- Do not add dependencies.

---

## File Structure

Create:

- lib/dictionary-index-cache.ts — the sole IndexedDB schema opener and serialized dictionary-index backend.
- lib/cvdict.ts — source URL, metadata parser, validation, stream parser wiring, and deterministic hash.
- lib/cvdict-cache.ts — CVDICT cache namespace wrapper.
- entrypoints/settings/cvdict-install-types.ts — worker protocol.
- entrypoints/settings/cvdict-install.worker.ts — fetch, stream, parse, index, and cache install.
- docs/dictionaries/CVDICT.md — attribution and maintenance instructions.
- tests/cvdict.test.ts, tests/cvdict-cache.test.ts, tests/cvdict-install.worker.test.ts, tests/ai-vietnamese.test.ts.

Modify:

- package.json, package-lock.json, CHANGELOG.md, wxt.config.ts.
- lib/types.ts, lib/settings.ts, lib/i18n.ts, lib/dictionary.ts, lib/dictionary-cache.ts, lib/kaikki-cache.ts, lib/dictionary-loader.ts, lib/word-insight.ts.
- entrypoints/settings/SettingsApp.tsx.
- entrypoints/dashboard/App.tsx, entrypoints/dashboard/hooks/useWordInsight.ts, entrypoints/dashboard/hooks/useAiInsight.ts.
- entrypoints/dashboard/components/WordList.tsx, entrypoints/dashboard/components/WordCard.tsx, entrypoints/dashboard/components/WordInsightPanel.tsx, entrypoints/dashboard/components/DefinitionList.tsx, entrypoints/dashboard/components/AiInsightSection.tsx, and entrypoints/dashboard/components/ReviewInsightReveal.tsx.
- lib/ai/prompt.ts, lib/ai/parse.ts, lib/ai/client.ts.
- sync-mutation-handler, lib/sync/mutations.ts, lib/sync/types.ts, lib/sync/project.ts.
- lib/backup.ts, lib/markdown.ts, README.md, AGENTS.md and focused existing tests.

### Task 0: Confirm baseline and preserve user work

**Files:** none.

**Interfaces:** none.

- [ ] **Step 1: Inspect the worktree**

Run: git status --short

Expected: test-debug.mjs is untracked. Do not change it. Stage only files named by each commit step.

- [ ] **Step 2: Verify the current baseline**

Run: npm run compile && npm test

Expected: both pass. If either fails, stop and report the pre-existing failure before feature work.

### Task 1: Version, CVDICT settings schema, and messages

**Files:**

- Modify: package.json, package-lock.json, CHANGELOG.md.
- Modify: lib/types.ts, lib/settings.ts, lib/i18n.ts.
- Test: tests/settings.test.ts, tests/i18n.test.ts.

**Interfaces:**

Produces CvdictSettings, DEFAULT_CVDICT_SETTINGS, setCvdictEnabled, recordCvdictInstall, resetCvdict, and AppSettings.cvdict.

~~~ts
export interface CvdictSettings {
  enabled: boolean;
  hash: string | null;
  entryCount: number;
  version: string | null;
  release: string | null;
  installedAt: number | null;
}
~~~

- [ ] **Step 1: Add failing normalization and mutation tests**

Append to tests/settings.test.ts:

~~~ts
it('adds disabled CVDICT defaults when old settings are read', () => {
  const old = { uiLocale: 'en' as const, kaikki: DEFAULT_SETTINGS.kaikki, srs: DEFAULT_SETTINGS.srs };
  expect(normalizeSettings(old).cvdict).toEqual(DEFAULT_CVDICT_SETTINGS);
});

it('keeps installed CVDICT metadata when merely disabled', () => {
  const installed = recordCvdictInstall(DEFAULT_SETTINGS, {
    hash: 'cv1', entryCount: 2, version: '1.0.1',
    release: '2024-12-02T17:46:19Z', installedAt: 100,
  });
  expect(setCvdictEnabled(installed, false).cvdict).toMatchObject({
    enabled: false, hash: 'cv1', entryCount: 2,
  });
});
~~~

- [ ] **Step 2: Prove the tests fail**

Run: npx vitest run tests/settings.test.ts

Expected: the CVDICT types/defaults/helpers are missing.

- [ ] **Step 3: Add the minimal settings implementation**

Add CvdictSettings in lib/types.ts after KaikkiSettings, add cvdict to AppSettings, and add disabled DEFAULT_CVDICT_SETTINGS to lib/settings.ts. Extend StoredAppSettings with cvdict?: Partial<CvdictSettings>; normalize it just as kaikki and srs are normalized. Implement immutable helpers:

~~~ts
export function setCvdictEnabled(settings: AppSettings, enabled: boolean): AppSettings {
  return { ...settings, cvdict: { ...settings.cvdict, enabled } };
}
~~~

recordCvdictInstall must set enabled true and merge successful metadata. resetCvdict must restore DEFAULT_CVDICT_SETTINGS without changing locale, Kaikki, or SRS.

- [ ] **Step 4: Add localized keys and release metadata**

Add matched en and zh-CN messages for dictionary.cvdict, dictionary.cvdictBadge, insight.vietnameseDefinitions, settings.cvdictBody, settings.installEnableCvdict, settings.enableCvdict, settings.updateCvdict, settings.removeCvdict, settings.cvdictNotInstalled, settings.cvdictDownloading, settings.cvdictIndexing, settings.cvdictTooLarge, settings.cvdictNoEntries, settings.cvdictPermissionDenied, settings.cvdictRetry, settings.cvdictInstalledEntries, settings.cvdictVersion, settings.cvdictRelease, settings.cvdictInstalledAt, and settings.cvdictSource.

Set package and root lock metadata to 0.4.5. Add a 0.4.5 changelog entry for optional local CVDICT and AI · VI.

- [ ] **Step 5: Verify and commit**

Run: npx vitest run tests/settings.test.ts tests/i18n.test.ts && npm run compile

Expected: pass.

~~~sh
git add package.json package-lock.json CHANGELOG.md lib/types.ts lib/settings.ts lib/i18n.ts tests/settings.test.ts tests/i18n.test.ts
git commit -m "feat: add CVDICT settings schema"
~~~

### Task 2: Shared dictionary IndexedDB backend and CVDICT parser

**Files:**

- Create: lib/dictionary-index-cache.ts, lib/cvdict.ts, lib/cvdict-cache.ts, tests/cvdict.test.ts, tests/cvdict-cache.test.ts.
- Modify: lib/dictionary.ts, lib/dictionary-cache.ts, lib/kaikki-cache.ts, tests/dictionary-cache.test.ts, tests/kaikki-cache.test.ts.

**Interfaces:**

Produces createCedictStreamParser, CVDICT_SOURCE_URL, MAX_CVDICT_DOWNLOAD_BYTES, isCvdictSizeAllowed, hashDictionaryEntries, getCvdictCache, setCvdictCache, and clearCvdictCache.

~~~ts
export type DictionaryIndexStore = 'dictionary-cache' | 'kaikki-cache' | 'cvdict-cache';

export interface CedictStreamResult {
  entries: ParsedCedictEntry[];
  skipped: number;
  metadata: { version: string | null; release: string | null };
}
~~~

- [ ] **Step 1: Write failing parser and cache tests**

Create tests/cvdict.test.ts:

~~~ts
const source = '#! version=1.0.1\n#! date=2024-12-02T17:46:19Z\n你好 你好 [ni3 hao3] /xin chào/\n學習 学习 [xue2 xi2] /học tập/\n';

it('parses metadata and entries split across chunks', () => {
  const parser = createCedictStreamParser();
  parser.addChunk(source.slice(0, 31));
  parser.addChunk(source.slice(31));
  expect(parser.finish()).toMatchObject({
    metadata: { version: '1.0.1', release: '2024-12-02T17:46:19Z' },
    entries: [{ simplified: '你好', definitions: ['xin chào'] }],
  });
});

it('rejects a byte count above the CVDICT ceiling', () => {
  expect(isCvdictSizeAllowed(MAX_CVDICT_DOWNLOAD_BYTES + 1)).toBe(false);
});
~~~

Create tests/cvdict-cache.test.ts using the injected cache backend used by the existing cache tests. Assert setCvdictCache followed by getCvdictCache round-trips a one-entry index and clearCvdictCache removes it.

- [ ] **Step 2: Prove the tests fail**

Run: npx vitest run tests/cvdict.test.ts tests/cvdict-cache.test.ts

Expected: imports/modules do not yet exist.

- [ ] **Step 3: Make IndexedDB schema ownership single-source**

Create lib/dictionary-index-cache.ts with DB_NAME shiyu-hanzi-box, version 3, and fixed stores dictionary-cache, kaikki-cache, and cvdict-cache. In onupgradeneeded, create every missing named store. Move the existing serialized Map shape into this backend:

~~~ts
interface SerializedIndex {
  v: 1;
  pairs: Array<[string, DictionaryEntry[]]>;
  maxKeyLength: number;
}
~~~

Make dictionary-cache.ts, kaikki-cache.ts, and cvdict-cache.ts thin namespace wrappers with their existing test injection seams. Remove every dictionary cache path that calls indexedDB.open with version 2.

- [ ] **Step 4: Implement streaming parsing and validation**

Extract line accumulation from parseCedictText into createCedictStreamParser in lib/dictionary.ts. addChunk must retain only the unfinished final line; finish must consume it and capture #! version and #! date headers.

In lib/cvdict.ts, export the fixed URL and 25 * 1024 * 1024 byte limit, validate the byte limit, require nonempty entries plus version/release metadata, and hash the materialized entries deterministically using the project’s FNV-1a pattern.

- [ ] **Step 5: Verify and commit**

Run: npx vitest run tests/dictionary.test.ts tests/dictionary-cache.test.ts tests/kaikki-cache.test.ts tests/cvdict.test.ts tests/cvdict-cache.test.ts && npm run compile

Expected: pass.

~~~sh
git add lib/dictionary-index-cache.ts lib/dictionary.ts lib/dictionary-cache.ts lib/kaikki-cache.ts lib/cvdict.ts lib/cvdict-cache.ts tests/dictionary.test.ts tests/dictionary-cache.test.ts tests/kaikki-cache.test.ts tests/cvdict.test.ts tests/cvdict-cache.test.ts
git commit -m "feat: add local CVDICT index cache"
~~~

### Task 3: Permission-gated CVDICT installer and Settings UI

**Files:**

- Create: entrypoints/settings/cvdict-install-types.ts, entrypoints/settings/cvdict-install.worker.ts, tests/cvdict-install.worker.test.ts.
- Modify: wxt.config.ts, entrypoints/settings/SettingsApp.tsx, tests/settings.test.ts.

**Interfaces:**

~~~ts
export type CvdictInstallWorkerResponse =
  | { type: 'progress'; loadedBytes: number; totalBytes: number | null; entryCount: number; skipped: number }
  | { type: 'indexing'; entryCount: number; skipped: number }
  | { type: 'complete'; hash: string; entryCount: number; version: string; release: string }
  | { type: 'cancelled' }
  | { type: 'error'; code: 'network' | 'http' | 'too-large' | 'invalid-data' };
~~~

- [ ] **Step 1: Write failing worker tests**

Create tests/cvdict-install.worker.test.ts with mocked fetch, worker postMessage collection, and setCvdictCache spy:

~~~ts
it('writes only a complete valid parsed index', async () => {
  await runInstallWorker(validCvdictResponse());
  expect(setCvdictCache).toHaveBeenCalledWith('expected-hash', expect.anything());
  expect(posted.at(-1)).toMatchObject({ type: 'complete', entryCount: 2, version: '1.0.1' });
});

it('does not write a cache entry for an oversized response', async () => {
  await runInstallWorker(responseLargerThan(MAX_CVDICT_DOWNLOAD_BYTES));
  expect(setCvdictCache).not.toHaveBeenCalled();
  expect(posted.at(-1)).toEqual({ type: 'error', code: 'too-large' });
});
~~~

- [ ] **Step 2: Prove failure**

Run: npx vitest run tests/cvdict-install.worker.test.ts

Expected: worker protocol and worker implementation do not exist.

- [ ] **Step 3: Add manifest permission and worker**

Append https://raw.githubusercontent.com/* to optional_host_permissions in wxt.config.ts. Do not add it to permissions.

Implement the worker to fetch only CVDICT_SOURCE_URL, reject !res.ok, stream response.body through TextDecoder and createCedictStreamParser, report throttled progress, abort after cancel, validate, buildIndex, cache under content hash, and emit one complete response. It must never write Settings.

- [ ] **Step 4: Wire Settings behavior**

Before creating the worker, request:

~~~ts
const granted = await browser.permissions.request({
  origins: ['https://raw.githubusercontent.com/*'],
});
~~~

A thrown/false request shows settings.cvdictPermissionDenied and does not create the worker. On complete call recordCvdictInstall through mutate. On error/cancel leave settings unchanged. Disable uses setCvdictEnabled without clearing. Remove first clears settings.cvdict.hash through clearCvdictCache, then calls resetCvdict. Terminate an active worker on unmount.

- [ ] **Step 5: Verify and commit**

Run: npx vitest run tests/cvdict-install.worker.test.ts tests/settings.test.ts && npm run build && rg -n 'raw.githubusercontent.com' .output/chrome-mv3/manifest.json

Expected: tests pass and the generated manifest lists the raw origin as optional.

~~~sh
git add wxt.config.ts entrypoints/settings/SettingsApp.tsx entrypoints/settings/cvdict-install-types.ts entrypoints/settings/cvdict-install.worker.ts tests/cvdict-install.worker.test.ts tests/settings.test.ts
git commit -m "feat: install CVDICT from settings"
~~~

### Task 4: Separate dictionary indexes and Vietnamese definition rendering

**Files:**

- Modify: lib/types.ts, lib/dictionary-loader.ts, lib/word-insight.ts, entrypoints/dashboard/hooks/useWordInsight.ts, entrypoints/dashboard/App.tsx, entrypoints/dashboard/components/WordList.tsx, entrypoints/dashboard/components/WordCard.tsx, entrypoints/dashboard/components/WordInsightPanel.tsx, entrypoints/dashboard/components/DefinitionList.tsx.
- Test: tests/dictionary-loader.test.ts, tests/word-insight.test.ts.

**Interfaces:**

~~~ts
export interface DictionaryIndexes {
  english: DictionaryIndex | null;
  vietnamese: DictionaryIndex | null;
}

export interface VietnameseDictionaryInsight {
  exactEntries: DictionaryEntry[];
  componentEntries: DictionaryEntry[];
  status: 'disabled' | 'ready' | 'no-definition' | 'dictionary-unavailable';
}
~~~

- [ ] **Step 1: Add failing separation tests**

Add to tests/dictionary-loader.test.ts:

~~~ts
it('loads enabled cached CVDICT separately from English definitions', async () => {
  await settingsStorage.setValue(recordCvdictInstall(DEFAULT_SETTINGS, cvdictMeta));
  await setCvdictCache('cv1', buildIndex([
    { index: 0, traditional: '你好', simplified: '你好', pinyin: 'ni3 hao3', definitions: ['xin chào'] },
  ]));
  const result = await loadDictionary(await getSettings());
  expect(result.indexes.english!.byForm.get('你好')![0].definitions).toEqual(['hello']);
  expect(result.indexes.vietnamese!.byForm.get('你好')![0].definitions).toEqual(['xin chào']);
});
~~~

Add to tests/word-insight.test.ts:

~~~ts
it('keeps Vietnamese entries out of English exactEntries', () => {
  const insight = computeWordInsight(word, { english: englishIndex, vietnamese: vietnameseIndex });
  expect(insight.exactEntries[0].definitions).toEqual(['hello']);
  expect(insight.vietnamese.exactEntries[0].definitions).toEqual(['xin chào']);
});
~~~

- [ ] **Step 2: Prove failure**

Run: npx vitest run tests/dictionary-loader.test.ts tests/word-insight.test.ts

Expected: the old one-index loader and insight type cannot satisfy the tests.

- [ ] **Step 3: Refactor loader and pure insight model**

Make loadDictionary accept normalized Settings and return DictionaryIndexes. Preserve CC-CEDICT plus Kaikki merge only in indexes.english. Load CVDICT from cvdict-cache only when enabled/hash are set. Add cvdict to DictionarySourceId but never merge its index into English.

Make computeWordInsight accept DictionaryIndexes, preserve English tone/status logic, and return a VietnameseDictionaryInsight with exact-or-component entries. Disabled cache returns disabled; enabled metadata with absent cache returns dictionary-unavailable.

- [ ] **Step 4: Make dashboard session reload settings-aware and render**

Derive a cache key from Kaikki enabled/hash plus CVDICT enabled/hash in App.tsx and pass it to WordList, WordCard, WordInsightPanel, and useWordInsight. Replace the hook’s one global promise with Map<string, Promise<LoadState>>.

Render Vietnamese DefinitionList only for ready/no-definition result with entries. Add showPinyin?: boolean to DefinitionList; call it false for CVDICT. Add a CVDICT badge branch.

- [ ] **Step 5: Verify and commit**

Run: npx vitest run tests/dictionary-loader.test.ts tests/word-insight.test.ts tests/i18n-source.test.ts && npm run compile

Expected: pass including disabled and missing-cache cases.

~~~sh
git add lib/types.ts lib/dictionary-loader.ts lib/word-insight.ts entrypoints/dashboard/hooks/useWordInsight.ts entrypoints/dashboard/App.tsx entrypoints/dashboard/components/WordList.tsx entrypoints/dashboard/components/WordCard.tsx entrypoints/dashboard/components/WordInsightPanel.tsx entrypoints/dashboard/components/DefinitionList.tsx tests/dictionary-loader.test.ts tests/word-insight.test.ts
git commit -m "feat: show CVDICT Vietnamese definitions"
~~~

### Task 5: Vietnamese AI prompt, atomic persistence, and sync registers

**Files:**

- Modify: lib/types.ts, lib/ai/prompt.ts, lib/ai/parse.ts, lib/ai/client.ts, entrypoints/dashboard/hooks/useAiInsight.ts, entrypoints/background/sync-mutation-handler.ts, lib/sync/mutations.ts, lib/sync/types.ts, lib/sync/project.ts.
- Create: tests/ai-vietnamese.test.ts.
- Modify: tests/ai-prompt.test.ts, tests/ai-parse.test.ts, tests/sync/project.test.ts, tests/sync/merge.test.ts, tests/sync/write-routing.test.ts.

**Interfaces:**

~~~ts
export type AiInsightLanguage = 'en' | 'vi';
export type WordAiInsightPatch =
  | { wordId: string; language: 'en'; insight: AiInsight }
  | { wordId: string; language: 'vi'; insight: VietnameseAiInsight };
~~~

- [ ] **Step 1: Write failing prompt, persistence, and merge tests**

Create tests/ai-vietnamese.test.ts:

~~~ts
it('uses Vietnamese instructions and CVDICT grounding only for AI VI', () => {
  const messages = buildWordInsightMessages({
    word, language: 'vi', pinyin: 'ni3 hao3',
    englishEntries: [], vietnameseEntries: [cvdictEntry], recentOccurrence: undefined,
  });
  expect(messages[0].content).toContain('Vietnamese');
  expect(messages[1].content).toContain('xin chào');
  expect(messages[1].content).not.toContain('CEDICT entries');
});

it('patches Vietnamese output without replacing English output', async () => {
  await applyWordAiInsight({ wordId: 'w1', language: 'vi', insight: vietnameseInsight });
  expect((await getInbox()).words[0]).toMatchObject({
    aiInsight: englishInsight, aiVietnameseInsight: vietnameseInsight,
  });
});
~~~

Add a sync merge test where one replica has a newer English insight and another has a newer Vietnamese insight; materialization must contain both.

- [ ] **Step 2: Prove failure**

Run: npx vitest run tests/ai-vietnamese.test.ts tests/sync/project.test.ts tests/sync/merge.test.ts

Expected: Vietnamese types, prompt, atomic patch, and separate register are missing.

- [ ] **Step 3: Implement strict language-specific AI contracts**

Add VietnameseAiInsight and aiVietnameseInsight? to WordEntry. Replace the hard-coded word prompt with EN_SYSTEM_PROMPT and VI_SYSTEM_PROMPT. Both request JSON-only output with the existing seven fields. AI VI requires natural Vietnamese summary, definitions, translations, and notes; sample sentences/collocations remain Chinese.

Make buildWordInsightMessages choose only the requested language’s exact dictionary entries. Make parseAiResponse accept language and attach outputLanguage: 'vi' only to Vietnamese output. Make fetchAiInsight forward language through parser and preserve the existing error contract.

- [ ] **Step 4: Add atomic background word patch routing**

Add wordAiInsight to SyncMutationRequestMessage.kind. Implement applyWordAiInsight in lib/sync/mutations.ts: obtain the current inbox inside the existing mutation path, map only matching wordId, set exactly aiInsight or aiVietnameseInsight, update updatedAt, call setInbox, and schedule sync. Reject unknown words. useAiInsight must call requestSyncMutation('wordAiInsight', patch), never send a full inbox replacement.

- [ ] **Step 5: Project independent sync fields**

Project aiInsight and aiVietnameseInsight as distinct Word-node fields. Stamp each valid field with its generatedAt and only fall back to word.updatedAt for legacy/malformed input. Validate both fields independently while materializing. This prevents later unrelated word edits from winning over a newer peer insight.

- [ ] **Step 6: Update hook permission and independent state**

Make useAiInsight accept English/Vietnamese exact entries and expose:

~~~ts
{
  english: { state: AiRequestState; error: string; request(): Promise<void> };
  vietnamese: { state: AiRequestState; error: string; request(): Promise<void> };
}
~~~

Before either request call requestAiSettingsPermission(settings). Permission denial, provider error, or parse error changes only that slot state and emits no patch.

- [ ] **Step 7: Verify and commit**

Run: npx vitest run tests/ai-prompt.test.ts tests/ai-parse.test.ts tests/ai-vietnamese.test.ts tests/sync/project.test.ts tests/sync/merge.test.ts tests/sync/write-routing.test.ts && npm run compile

Expected: both outputs coexist after local patches and merges.

~~~sh
git add lib/types.ts lib/ai/prompt.ts lib/ai/parse.ts lib/ai/client.ts entrypoints/dashboard/hooks/useAiInsight.ts entrypoints/background/sync-mutation-handler.ts lib/sync/mutations.ts lib/sync/types.ts lib/sync/project.ts tests/ai-prompt.test.ts tests/ai-parse.test.ts tests/ai-vietnamese.test.ts tests/sync/project.test.ts tests/sync/merge.test.ts tests/sync/write-routing.test.ts
git commit -m "feat: add Vietnamese AI word insights"
~~~

### Task 6: AI UI, backup/export parity, documentation, and release verification

**Files:**

- Modify: entrypoints/dashboard/components/WordInsightPanel.tsx, entrypoints/dashboard/components/AiInsightSection.tsx, entrypoints/dashboard/components/ReviewInsightReveal.tsx, lib/backup.ts, lib/markdown.ts, README.md, AGENTS.md.
- Create: docs/dictionaries/CVDICT.md.
- Modify: tests/backup-ai.test.ts, tests/markdown.test.ts, tests/i18n-source.test.ts.

**Interfaces:**

Consumes the two-slot useAiInsight result and both optional WordEntry AI fields. Produces distinct display headings and Markdown sections.

- [ ] **Step 1: Write failing backup and Markdown tests**

Append to tests/backup-ai.test.ts:

~~~ts
it('round-trips independent English and Vietnamese insights', () => {
  const restored = parseBackup(serializeBackup({
    words: [{ ...word, aiInsight: englishInsight, aiVietnameseInsight: vietnameseInsight }],
    quotes: [],
  }));
  expect(restored.words[0].aiInsight).toEqual(englishInsight);
  expect(restored.words[0].aiVietnameseInsight).toEqual(vietnameseInsight);
});
~~~

Append to tests/markdown.test.ts:

~~~ts
it('renders separate English and Vietnamese AI sections', () => {
  const md = renderDay(day, [{
    ...word, aiInsight: englishInsight, aiVietnameseInsight: vietnameseInsight,
  }], []);
  expect(md).toContain('## AI English Insight');
  expect(md).toContain('## AI Vietnamese Insight');
  expect(md).toContain(vietnameseInsight.summary);
});
~~~

- [ ] **Step 2: Prove failure**

Run: npx vitest run tests/backup-ai.test.ts tests/markdown.test.ts

Expected: Vietnamese AI is not yet preserved/rendered.

- [ ] **Step 3: Render AI · EN and AI · VI independently**

Update WordInsightPanel to render two localized controls with the independent hook states. Make AiInsightSection accept a localized title prop and render English and Vietnamese sections separately. Keep either stored result visible while the other request is loading. Update ReviewInsightReveal to show cached English/Vietnamese sections only after Reveal.

- [ ] **Step 4: Safely preserve and export both outputs**

Keep backup’s permissive optional-field round trip. Before Markdown rendering, validate summary/register/notes as strings; validate definition, sentence, translation, and collocation arrays as string arrays with parallel sentence/translation lengths. Render exact headings AI English Insight and AI Vietnamese Insight. Invalid restored data is skipped, not rendered.

- [ ] **Step 5: Write CVDICT docs**

Create docs/dictionaries/CVDICT.md with the raw source URL, repository URL, CC BY-SA 4.0 attribution, CVDICT/CC-CEDICT derivation, explicit local install/update flow, no-sync cache boundary, and accuracy caveat. Update README and AGENTS.md to describe CVDICT worker/cache, separate dictionary indexes, AI EN/VI fields, and local-only sync behavior.

- [ ] **Step 6: Complete verification and commit**

Run: npx vitest run tests/backup-ai.test.ts tests/markdown.test.ts tests/i18n-source.test.ts && npm run compile && npm test && npm run build && cat .output/chrome-mv3/manifest.json && git diff --check && git status --short

Expected: all checks pass, the manifest lists raw GitHub only under optional_host_permissions, there are no whitespace errors, and test-debug.mjs remains untracked.

~~~sh
git add entrypoints/dashboard/components/WordInsightPanel.tsx entrypoints/dashboard/components/AiInsightSection.tsx entrypoints/dashboard/components/ReviewInsightReveal.tsx lib/backup.ts lib/markdown.ts README.md AGENTS.md docs/dictionaries/CVDICT.md tests/backup-ai.test.ts tests/markdown.test.ts tests/i18n-source.test.ts
git commit -m "docs: document CVDICT and Vietnamese AI insights"
~~~

### Task 7: CVDICT-gated Hanzii word shortcut

**Files:**

- Modify: `lib/external-dictionaries.ts`, `lib/types.ts`, `lib/word-insight.ts`, `lib/i18n.ts`, `entrypoints/dashboard/components/SourceExamples.tsx`.
- Test: `tests/external-dictionaries.test.ts`, `tests/word-insight.test.ts`, `tests/source-examples.test.tsx`, `tests/i18n.test.ts`.
- Document: `README.md`, `AGENTS.md`, `docs/superpowers/specs/2026-07-26-cvdict-vietnamese-insights-design.md`, `docs/dictionaries/CVDICT.md`.

**Interfaces:**

`buildExternalLinks(word, cvdictEnabled)` retains Youdao and 百度汉语 and appends a localized Hanzii link only when `cvdictEnabled` is true. The Hanzii URL is exactly `https://hanzii.net/search/word/${encodeURIComponent(word.text)}?hl=vi`.

- [ ] **Step 1: Add failing URL, visibility, and i18n tests**

Assert that a CVDICT-enabled word insight contains the exact encoded Hanzii URL, a disabled insight omits it, `dictionary.hanziiLookup` has en/zh-CN values, and the outbound anchor renders the localized label.

- [ ] **Step 2: Prove failure**

Run: `npx vitest run tests/external-dictionaries.test.ts tests/word-insight.test.ts tests/source-examples.test.tsx tests/i18n.test.ts`

Expected: Hanzii is absent and the new message key is missing.

- [ ] **Step 3: Implement the click-only shortcut**

Extend the external-link view type with Hanzii/Chinese-Vietnamese and an optional localized-label key. Pass the existing `cvdictEnabled` flag from `computeWordInsight` into `buildExternalLinks`. Render the label through `t`; keep the existing plain `target="_blank"` anchor with no fetch or permission code.

- [ ] **Step 4: Verify and commit**

Run: `npx vitest run tests/external-dictionaries.test.ts tests/word-insight.test.ts tests/source-examples.test.tsx tests/i18n.test.ts tests/i18n-source.test.ts && npm run compile`

Expected: all focused tests and TypeScript pass.

~~~sh
git add lib/external-dictionaries.ts lib/types.ts lib/word-insight.ts lib/i18n.ts entrypoints/dashboard/components/SourceExamples.tsx tests/external-dictionaries.test.ts tests/word-insight.test.ts tests/source-examples.test.tsx tests/i18n.test.ts README.md AGENTS.md docs/superpowers/specs/2026-07-26-cvdict-vietnamese-insights-design.md docs/superpowers/plans/2026-07-26-cvdict-vietnamese-insights.md docs/dictionaries/CVDICT.md
git commit -m "feat: add CVDICT-gated Hanzii lookup"
~~~

## Plan Self-Review

- **Spec coverage:** Task 1 covers version/settings/i18n; Task 2 parser and schema safety; Task 3 install permission/worker/UI; Task 4 separate lookup/display; Task 5 language-specific AI, concurrency, permission, and sync; Task 6 output parity, docs, and verification; Task 7 adds the enabled-only click-through Hanzii shortcut.
- **Placeholder scan:** Each task has exact files, interfaces, test examples, commands, and implementation behavior; no later-fill-in items remain.
- **Type consistency:** CvdictSettings, DictionaryIndexes, VietnameseDictionaryInsight, VietnameseAiInsight, and WordAiInsightPatch are defined before later consumers use them.

## Execution Handoff

Plan complete and saved to docs/superpowers/plans/2026-07-26-cvdict-vietnamese-insights.md.

Two execution options:

1. **Subagent-Driven (recommended)** — dispatch a fresh subagent per task with review between tasks.
2. **Inline Execution** — execute tasks in this session using superpowers:executing-plans, with checkpoints for review.
