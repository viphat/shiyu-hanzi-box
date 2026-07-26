# CVDICT + Vietnamese AI Word Insights — Design

Version target: 0.4.5
Date: 2026-07-26

## Goal

Extend Word Insight with three clearly separated, opt-in aids:

1. bundled offline Chinese-English definitions from CC-CEDICT, with the existing optional Kaikki English fallback;
2. an optional, locally installed Chinese-Vietnamese definition layer from CVDICT; and
3. explicit-click AI insights in English or Vietnamese using the existing BYO-key provider configuration.

The feature remains local-first. CVDICT is not bundled, no download occurs until the user requests it, and neither CVDICT nor AI changes capture, dedupe, SRS, cloze offsets, traditional conversion, or export behavior.

## Scope

Included:

- A Settings card with CVDICT install-and-enable, disable, update, retry, cancel, and remove-local-data controls.
- An explicit-click streamed worker download from https://raw.githubusercontent.com/ph0ngp/CVDICT/main/CVDICT.u8.
- Local IndexedDB parsing and indexing of CVDICT.
- A separate Vietnamese definition section in expanded Word Insight cards.
- Independent AI · EN and AI · VI actions and persisted results.
- Vietnamese AI grounding with locally installed CVDICT exact entries when available.
- Backup, Markdown, review-reveal, and sync support for separate English and Vietnamese AI results.
- CVDICT attribution and update documentation.

Excluded:

- Automatic download, update polling, or arbitrary source URLs.
- CVDICT for quote translation or any capture/review algorithm.
- A Vietnamese application locale.
- A new AI provider, API key, or provider-origin permission.
- Automatic AI calls following install or card rendering.

## Source, License, and Trust Boundary

CVDICT is a Chinese-Vietnamese derivative of CC-CEDICT distributed in the compatible traditional simplified [pinyin] /definitions/ line format. The canonical source URL is fixed in code; users cannot edit it.

The user clicks Install & enable CVDICT, then Chrome requests the optional origin https://raw.githubusercontent.com/*. A module worker fetches and streams the file, rejects non-OK responses and files larger than 25 MiB, parses valid CEDICT-shaped lines, and refuses to enable an empty result. It stores a parsed lookup index, not the source file, only in IndexedDB. Definitions are untrusted text and must never be rendered as HTML.

Settings shows source, version, release, entry count, install time, hash, source link, and CC BY-SA 4.0 attribution. docs/dictionaries/CVDICT.md records attribution, update steps, source details, and the publisher's accuracy caveat.

## User Experience

The CVDICT card appears after bundled CC-CEDICT and before the Kaikki fallback.

| State | Behavior |
| --- | --- |
| Not installed | Install & enable CVDICT explains that data is stored in this browser only. |
| Permission pending | Install control is disabled until permission resolves. |
| Downloading/indexing | Show progress, byte count where known, usable entry count, and Cancel. |
| Installed/enabled | Show enabled checkbox, metadata, Check for update, and Remove local data. |
| Installed/disabled | Show Enable and Remove local data; do not redownload. |
| Failed/cancelled | Show localized retry state; preserve any prior working index. |
| Restored stale metadata | State says not installed on this device and offers reinstall. |

Disabling preserves the cache. Removing local data disables CVDICT, clears the matching cache key, and resets metadata. Updating repeats the explicit install flow and changes metadata only after a complete replacement index exists.

When CVDICT is enabled and locally cached, Word Insight renders Vietnamese definitions immediately after English definitions. Exact CVDICT entries are preferred; otherwise it uses the existing component fallback. Pinyin is hidden in this section because it is already displayed above it.

AI · EN generates or regenerates English output under AI English insight. AI · VI generates or regenerates Vietnamese output under AI Vietnamese insight. Each action has independent loading, error, and retry state. Running one never hides, clears, or changes the other cached output.

## Data Model

~~~ts
export interface CvdictSettings {
  enabled: boolean;
  hash: string | null;
  entryCount: number;
  version: string | null;
  release: string | null;
  installedAt: number | null;
}

export interface VietnameseAiInsight extends AiInsight {
  outputLanguage: 'vi';
}

export interface WordEntry extends EntryBase {
  aiInsight?: AiInsight;
  aiVietnameseInsight?: VietnameseAiInsight;
}
~~~

AppSettings gains cvdict: CvdictSettings. normalizeSettings supplies disabled defaults for existing installs. A non-null hash means an index was successfully installed at some point; it does not prove the active profile still has the IndexedDB entry. Missing cache means the Vietnamese index is unavailable and Settings must offer reinstall without fetching automatically.

The three dictionary caches share one IndexedDB schema owner at database version 3: dictionary-cache, kaikki-cache, and cvdict-cache. Existing independent version-2 cache openers must be removed; otherwise they can throw VersionError after CVDICT upgrades the database.

CVDICT metadata and cache are local profile state. Folder sync does not project them and never downloads CVDICT on another device. Full backups may carry the Settings metadata but not the index; a restored profile therefore requires reinstall.

## Architecture and Data Flow

~~~mermaid
flowchart LR
  A["Settings: Install & enable"] --> B["Request raw GitHub permission"]
  B --> C["CVDICT install worker"]
  C --> D["Stream and parse CEDICT"]
  D --> E["IndexedDB CVDICT cache"]
  E --> F["Dictionary loader"]
  F --> G["Separate English and Vietnamese indexes"]
  G --> H["Word Insight"]
  H --> I["AI EN or AI VI"]
  I --> J["Configured provider"]
  J --> K["Atomic background word patch"]
  K --> L["Independent sync registers"]
~~~

1. The Settings click requests only the raw GitHub optional origin.
2. The worker fetches, parses, hashes, indexes, and writes CVDICT, then reports completion.
3. Settings records CVDICT metadata and enabled state only after success.
4. The dictionary loader builds the bundled CC-CEDICT/Kaikki English index and loads CVDICT separately only for enabled cached metadata.
5. The Word Insight session cache is keyed by Kaikki and CVDICT enabled/hash state, so an open dashboard reloads after install/remove.
6. An AI click requests the configured provider origin, uses a language-specific prompt, validates JSON, then sends one atomic word-field patch through the background worker.

## AI Prompt and Persistence Contract

Both AI paths send the Simplified word, saved pinyin when available, and newest source context. AI EN receives only English exact entries. AI VI receives only CVDICT exact entries when CVDICT is available. No request contains an entire index.

Both responses are JSON with summary, register, definitions, sampleSentences, translations, collocations, and notes. AI EN produces English summary/definitions/translations/notes. AI VI produces natural Vietnamese for those fields while retaining Chinese example sentences and Chinese collocations. The parser requires all values to be strings and sentence/translation arrays to have equal length.

~~~ts
type WordAiInsightPatch =
  | { wordId: string; language: 'en'; insight: AiInsight }
  | { wordId: string; language: 'vi'; insight: VietnameseAiInsight };
~~~

The background mutation reads the current authoritative inbox and changes only the requested field. UI hooks must not send a full stale inbox snapshot. Sync projects aiInsight and aiVietnameseInsight as separate LWW registers, stamped from each result's generatedAt rather than a later unrelated word updatedAt. Materialization validates both optional shapes before React or Markdown reads them.

Backup round-trips both fields. Markdown emits separate AI English Insight and AI Vietnamese Insight sections. Review can display cached results after Reveal only; it never triggers AI.

## Failure Handling and Acceptance Criteria

- Permission denial sends no download/provider fetch and shows localized retryable feedback.
- HTTP/network errors, oversized content, malformed data, no usable entries, worker errors, and cancellation do not change CVDICT metadata or replace a working index.
- An enabled setting with no cache renders no Vietnamese definitions and asks the user to reinstall.
- Unconfigured AI disables both actions. Invalid AI JSON, unsafe restored values, and provider failures write nothing.
- A new profile has no CVDICT request or Vietnamese section.
- A successful install makes exact and component Vietnamese definitions visible without mixing them into English results.
- English and Vietnamese AI actions can finish in either order, coexist after local writes, and coexist after sync merge.
- Old settings, backups, and WordEntry records remain valid.
- All user-facing strings exist in en and zh-CN.
- npm run compile, npm test, and npm run build pass, and the raw GitHub origin appears only in optional_host_permissions.

