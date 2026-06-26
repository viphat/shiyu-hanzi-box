# Chrome Web Store Submission Notes

Last updated: 2026-06-26

## Package

Build and package from the repository root:

```bash
npm run compile
npm test
npm run build
cat .output/chrome-mv3/manifest.json
npm run zip
```

Upload the generated Chrome MV3 zip from `.output/` in the Chrome Developer
Dashboard.

## Single Purpose

Capture selected Chinese words, phrases, and quotes while reading, store them
locally, enrich them with local dictionary and review tools, and export daily
Markdown notes.

## Permission Audit

- `contextMenus`: Adds user-triggered "save as word", "save as quote", and
  "open dashboard" actions.
- `storage`: Stores the local inbox, settings, API keys, AI results, and runtime
  metadata in extension storage.
- `activeTab`: Lets user-triggered capture read the active tab only after a
  context menu, command, or popup action.
- `scripting`: Injects the self-contained page-context reader into the active
  tab during capture.
- `downloads`: Saves Markdown, zip export, and JSON backup files after explicit
  export actions.
- `unlimitedStorage`: Supports the local-first inbox, dictionary cache, and
  optional large Kaikki import data.
- `clipboardRead`: Supports the popup "paste from clipboard and save" fallback
  when selected-text capture is unavailable.
- `tts`: Pronounces a saved Chinese word only after the user clicks its speaker
  button. Chrome selects a compatible Chinese voice from the operating system
  or an installed speech engine.

No declared required permission was found unused as of this audit.

## Optional Host Permissions

- `https://api.deepseek.com/*`: Requested only when the user enables DeepSeek
  and uses an AI action — word "Ask AI" insight or quote "建议填空" cloze
  suggestions — or tests the DeepSeek connection.
- `https://api.openai.com/*`: Requested only when the user enables OpenAI and
  uses an AI action (word insight or quote cloze suggestions) or tests the
  OpenAI connection.
- `https://*/*`: Allows users to configure a custom HTTPS OpenAI-compatible AI
  endpoint. This remains optional and is requested lazily for the specific
  origin derived from the configured Base URL.

`http://*/*` was removed. Custom AI endpoints must use HTTPS so API keys and
captured text are not sent over insecure transport.

## Remote Code Declaration

Select "No remote code." The extension calls AI providers as data APIs, but it
does not load or execute JavaScript from remote servers.

## User Data Disclosure

Disclose that the extension handles website content selected by the user, page
metadata for captured sources, user notes, local review ratings and schedules,
extension settings, and optional API keys. Data is stored locally by default.
Spaced-repetition scheduling does not require network access. AI provider
transfer occurs only after the user enables AI and clicks an AI action: word
"Ask AI" insight sends the saved word and its dictionary context, and quote
"建议填空" cloze suggestions send that quote's sentence text. When
pronunciation is requested, the selected saved word is passed to Chrome's
configured speech engine; some installed voices may use a remote speech
resource.

## Store Assets

The extension icon source is `assets/icon.png` at 512x512, and WXT auto-icons
generates packaged icon sizes.

Store listing assets prepared in this repo:

- `docs/store-assets/chrome-web-store-screenshot-dashboard.png` at 1280x800.
- `docs/store-assets/chrome-web-store-small-promo.png` at 440x280.

## Detailed Follow-Up

- Use `docs/chrome-web-store-dashboard-checklist.md` when filling Step 4 in the
  Chrome Developer Dashboard.
- Use `docs/chrome-web-store-reviewer-notes.md` when filling Step 5 reviewer
  notes and manual test instructions.
