# Chrome Web Store Dashboard Checklist

Last updated: 2026-06-22

Use this when completing the Chrome Developer Dashboard fields after uploading
`.output/shiyu-hanzi-box-0.1.0-chrome.zip`.

## Store Listing

Suggested extension name:

```text
拾语汉字box
```

Suggested short description:

```text
Capture Chinese words and quotes while reading, store them locally, and export daily Markdown notes.
```

Suggested detailed description:

```text
拾语汉字box is a local-first Chinese reading companion.

Select Chinese text on a page and save it as a word, phrase, or quote through the context menu, keyboard shortcut, or toolbar popup. The dashboard keeps your collection in local browser storage, shows offline dictionary insight from the bundled CC-CEDICT asset, and exports daily Markdown notes, zip archives, or JSON backups.

AI insight is optional and disabled by default. If enabled, users bring their own API key and explicitly click Ask AI for a saved word. The extension stores generated insight locally so each word only needs to be generated once.

Core features:
- Save selected Chinese words, phrases, and quotes.
- Deduplicate words while preserving source occurrences.
- View local dictionary definitions, pinyin tone chips, and source examples.
- Export daily Markdown notes and backup/restore local data.
- Optionally import a local Kaikki JSONL dictionary fallback.
- Optionally use BYO-key AI insight with DeepSeek, OpenAI, or a custom HTTPS OpenAI-compatible endpoint.
```

Suggested category:

```text
Productivity
```

Suggested language:

```text
Chinese (Simplified)
```

You can also mention English support in the description because the settings UI
supports English and zh-CN.

## Assets

Upload these local files:

- Screenshot: `docs/store-assets/chrome-web-store-screenshot-dashboard.png`
- Small promo tile: `docs/store-assets/chrome-web-store-small-promo.png`

The extension package already contains generated icon sizes from
`assets/icon.png`.

## Privacy Policy

Publish `PRIVACY.md` somewhere public and paste its public URL into the Privacy
Policy field. A GitHub-rendered URL after merging to `master` is acceptable for
early submission if it is public and stable.

Suggested GitHub URL after pushing `master`:

```text
https://github.com/viphat/shiyu-hanzi-box/blob/master/PRIVACY.md
```

## Single Purpose

Use this:

```text
Capture selected Chinese words, phrases, and quotes while reading, store them locally, enrich them with local dictionary context, and export daily Markdown notes.
```

## Permission Justifications

Use these explanations in the permissions/privacy sections.

```text
contextMenus: Adds user-triggered "save as word", "save as quote", and "open dashboard" actions.
```

```text
storage: Stores the local inbox, settings, API keys, AI results, and runtime metadata in Chrome extension storage.
```

```text
activeTab: Lets the extension read the active tab only after a user gesture such as a context menu, command, or popup action.
```

```text
scripting: Injects a self-contained page-context reader into the active tab during user-triggered capture.
```

```text
downloads: Saves Markdown notes, zip exports, and JSON backup files only after explicit export or backup actions.
```

```text
unlimitedStorage: Supports the local-first inbox, dictionary cache, and optional large local Kaikki dictionary imports.
```

```text
clipboardRead: Supports the toolbar popup "paste from clipboard and save" fallback when selected-text capture is unavailable.
```

## Optional Host Permission Justifications

```text
https://api.deepseek.com/*: Requested only when the user enables DeepSeek AI insight or tests the DeepSeek connection.
```

```text
https://api.openai.com/*: Requested only when the user enables OpenAI AI insight or tests the OpenAI connection.
```

```text
https://*/*: Allows users to configure a custom HTTPS OpenAI-compatible AI endpoint. The extension derives the specific origin from the configured Base URL and requests it lazily only when AI is enabled or tested.
```

## User Data Disclosure

Disclose these categories if the dashboard asks:

- Website content: selected text and surrounding source context saved by the
  user.
- User activity: saved review status, notes, and export actions inside the
  extension.
- Authentication information: optional user-provided AI API key, stored locally.
- Website metadata: source page title, URL, and domain for saved entries.

Suggested explanation:

```text
The extension stores selected text, notes, source metadata, local settings, optional API keys, and generated AI insights locally in the user's browser. AI data transfer happens only when the user enables AI and explicitly clicks an AI action. The extension does not operate a developer-owned server, does not create accounts, and does not sell user data.
```

## Remote Code

Choose "No remote code."

Suggested explanation if asked:

```text
The extension does not load or execute JavaScript from remote servers. Optional AI providers are contacted through JSON data API requests only after explicit user configuration and action.
```

## Distribution

Recommended first release settings:

- Visibility: Private or Unlisted for the first review pass if you want a safer
  launch path; Public when ready.
- Regions: All regions where you are comfortable supporting users.
- Pricing: Free, unless you later add a paid support or distribution plan.
