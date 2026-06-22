# 拾语汉字box

拾语汉字box is a local-first Chrome MV3 extension for collecting Chinese words,
phrases, and quotes while reading. Select text on a page, save it as a word or a
quote, keep the working inbox in local extension storage, and export daily
Markdown notes.

The project is built with WXT, React, TypeScript, Tailwind CSS, Vitest, and
`@webext-core/fake-browser`.

## Current Status

Implemented:

- WXT MV3 scaffold with React, Tailwind, Vitest, and Chrome permissions.
- Typed entry model for words, quotes, occurrences, and inbox storage.
- Chinese-oriented text normalization for word dedupe.
- Local `chrome.storage.local` inbox wrapper with serialized write updates.
- Core capture logic:
  - words dedupe by normalized text and append source occurrences;
  - quotes are saved as independent entries;
  - empty selections are ignored.
- Page-context reader for selected text, surrounding text, title, URL, and domain.
- Background service worker wiring for context menus and keyboard commands.
- Toolbar popup buttons for saving the current selection as a word or quote.
- Lazy pinyin generation with `pinyin-pro`.
- Daily Markdown rendering and zip export helpers.
- Versioned JSON backup export and validated restore import for the full local
  inbox.
- New-tab dashboard with search, status filters, cards, edit controls, pinyin,
  export actions, and backup/restore controls.
- Offline Word Insight Panel with CC-CEDICT definitions, tone chips, source
  examples, external dictionary links, and review reveal mode.
- Opt-in AI Insight layer with BYO API key, provider picker, generated bilingual
  notes persisted on words, and Markdown/backup/review integration.
- Settings page with English / zh-CN UI locale selection, full AI provider
  configuration, and optional dictionary controls.
- Optional runtime Kaikki JSONL import/download into local IndexedDB storage for
  extra dictionary fallback entries without growing the packed extension.
- Jade/ink Tailwind theme tokens and CJK font stack.
- Unit tests for normalization, capture/dedupe, background capture paths,
  pinyin, Markdown rendering, export generation, and backup restore validation.

## Word Insight Panel

Expanding a saved word in the dashboard shows:

- **Tone chips** — one per Chinese character, with tone marks and numbers.
- **Definitions** — from the bundled CC-CEDICT offline dictionary.
- **Component fallback** — for phrases with no exact match, definitions for
  the component characters.
- **Source examples** — the captured surrounding sentences with the word
  highlighted, deduped to the newest three.
- **External links** — click-only links to Youdao (Chinese-English) and
  百度汉语 (Chinese-Chinese). Nothing is fetched until you click.

Review cards gain a **显示释义** reveal button so you can test yourself before
seeing pinyin and definitions.

### AI Insight (opt-in)

The word card's expanded panel offers an "Ask AI" button that generates
structured bilingual definitions, sample sentences, collocations, and usage
notes. This is an **opt-in feature**: it requires a user-supplied API key and
does not run until you click the button.

How it works:

1. Open **Settings** from the dashboard toolbar, then use the **AI 设置** section.
2. Choose a provider: DeepSeek, OpenAI, or a custom OpenAI-compatible endpoint.
3. Paste your API key and select a model.
4. Click **测试连接** to verify the provider settings.
5. Expand any word card and click **Ask AI**.

Privacy:

- The API key is stored in `chrome.storage.local` on your device only.
- AI requests send only the saved word, optional pinyin, dictionary glosses, and
  one recent occurrence to the provider you chose.
- Generated insights are persisted on the word and flow into backups, exports,
  and review cards, so you only pay for each insight once.
- When AI is disabled, the extension makes no AI provider requests.

### Dictionary Attribution

Definitions come from [CC-CEDICT](https://www.mdbg.net/chinese/dictionary?page=cc-cedict),
licensed CC-BY-SA. See `docs/dictionaries/CC-CEDICT.md` for details and update
instructions. The dictionary ships as a compact offline asset; the extension
never contacts MDBG at runtime.

### Local Dictionary Privacy

The local Word Insight sections are fully offline. The only outbound dictionary
requests are the two external dictionary links, and only when you click them.
AI requests are separate, opt-in, and use only the provider configured by you.

## Settings, AI, And Optional Kaikki Dictionary

Open **Settings** from the dashboard toolbar to choose the UI locale:

- `zh-CN` keeps the original Simplified Chinese interface.
- `en` switches dashboard, popup, review, insight, and settings labels to
  English. Saved words, quotes, notes, backups, and Markdown exports are never
  translated.

CC-CEDICT remains the default bundled offline dictionary. For words that
CC-CEDICT misses, the settings page can optionally extend lookup with a Kaikki
JSONL dictionary source:

- **Import JSONL file** reads a local Kaikki JSONL file and stores processed
  entries in IndexedDB.
- **Download from Kaikki** asks for the optional `https://kaikki.org/*` host
  permission, downloads the configured Kaikki URL, processes it locally, and
  stores the compact index in IndexedDB.
- **Enable Kaikki fallback** controls whether the stored Kaikki index is used.
- **Remove Kaikki data** deletes the runtime Kaikki index and leaves the
  bundled CC-CEDICT dictionary untouched.

Kaikki data is not bundled into `public/` and is not added to the packed
extension. Large Kaikki dumps can take significant time and local browser
storage to process. Kaikki entries are used only as fallback definitions:
CC-CEDICT results stay first when both sources contain a word.

Kaikki data comes from [Kaikki/Wiktextract](https://kaikki.org/) and its
published dictionary dumps. Review the Kaikki source page and Wiktionary license
terms before redistributing imported dictionary data.

## How Capture Works

```mermaid
flowchart LR
  A["User selects Chinese text"] --> B["Context menu, command, or popup"]
  B --> C["background/capture-handler.ts"]
  C --> D["scripting.executeScript(readPageContext)"]
  D --> E["saveWord or saveQuote"]
  E --> F["storage local:inbox"]
  C --> G["Extension badge feedback"]
```

Words and quotes share common metadata such as `id`, `text`, `note`, `status`,
`createdAt`, `updatedAt`, and optional `pinyin`.

Words also store a `normalized` dedupe key and an `occurrences[]` list containing
source page metadata. Quotes store source metadata directly, keep optional tags,
and are not deduped.

## Project Layout

```text
entrypoints/
  background/
    index.ts             # registers context menus and commands
    capture-handler.ts   # active-tab selection capture + badge feedback
  popup/
    index.html
    main.tsx
    Popup.tsx            # save as word / save as quote buttons
  settings/
    index.html
    main.tsx
    SettingsApp.tsx      # locale + AI key + optional Kaikki dictionary settings
  newtab/
    index.html
    main.tsx
    App.tsx              # dashboard shell, filters, list wiring
    hooks/useAiInsight.ts # AI insight request + persistence hook
    hooks/useInbox.ts    # live WXT inbox storage hook
    hooks/useSettings.ts # live WXT settings storage hook
    components/          # toolbar, word/quote cards, lists, pinyin button
lib/
  ai/
    client.ts            # OpenAI-compatible fetch wrapper
    parse.ts             # AI JSON response validation
    permissions.ts       # lazy provider host permission requests
    prompt.ts            # prompt/message builder
    settings.ts          # local AI settings storage and presets
  capture.ts             # saveWord/saveQuote and word dedupe behavior
  export.ts              # export map + zip generation
  backup.ts              # versioned JSON backup + restore validation
  id.ts                  # dependency-free id generation
  markdown.ts            # daily note rendering
  i18n.ts                # EN/zh-CN UI messages
  kaikki.ts              # Kaikki JSONL parser and URL validation
  kaikki-cache.ts        # IndexedDB cache for runtime Kaikki indexes
  normalize.ts           # word normalization
  page-context.ts        # injected selection reader
  pinyin.ts              # pinyin-pro wrapper
  storage.ts             # WXT storage item and serialized mutations
  settings.ts            # WXT app settings storage and helpers
  types.ts               # persisted data shapes
tests/
  capture-handler.test.ts
  capture.test.ts
  export.test.ts
  markdown.test.ts
  normalize.test.ts
  pinyin.test.ts
```

Design and implementation planning live under `docs/superpowers/`.

## Development

Install dependencies:

```bash
npm install
```

Run the extension dev server:

```bash
npm run dev
```

Build the Chrome MV3 extension:

```bash
npm run build
```

Build output is written to `.output/chrome-mv3/`. Load that directory as an
unpacked extension in Chrome.

Run tests:

```bash
npm test
```

Typecheck:

```bash
npm run compile
```

Create a distributable zip:

```bash
npm run zip
```

## To Do

- Add capture undo and clearer save feedback after context menu, shortcut, and
  popup captures.
- Add review settings such as daily cap, interval presets, and review streak
  visibility.

## Useful Notes

- The manifest is configured in `wxt.config.ts`.
- The storage import path for this WXT version is `wxt/utils/storage`.
- WXT browser types are imported as `Browser` from `wxt/browser`; tab types are
  `Browser.tabs.Tab`.
- The base extension icon lives at `assets/icon.png`; WXT auto-icons generates
  the packed icon sizes during build.

## Test Coverage

The current test suite covers:

- normalization rules and idempotence;
- first word capture, normalized word dedupe, duplicate occurrence suppression,
  quote capture, and empty-input handling;
- background capture success, no-selection, restricted-page, no-active-tab, and
  quote paths using fake Chrome APIs;
- local pinyin generation;
- daily Markdown frontmatter, sections, words, quotes, quote tags, pinyin,
  source links, and AI insight sections;
- daily export grouping, archived-entry skipping, and zip byte generation.
- versioned backup JSON generation, legacy raw inbox restore, and invalid import
  rejection.
- AI settings presets, permission origin requests, prompt building, response
  parsing, client error handling, component rendering, and backup round-trip.
