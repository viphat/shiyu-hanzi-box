# Chrome Web Store Submission Notes

Last updated: 2026-08-11 (v0.5.0)

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
- `alarms`: Schedules periodic background folder-sync wakeups when the user has
  enabled the optional encrypted folder sync. Used only for sync timing; no
  alarms run unless sync is configured.
- `clipboardRead`: Supports the popup "paste from clipboard and save" fallback
  when selected-text capture is unavailable.
- `tts`: Pronounces a saved Chinese word only after the user clicks its speaker
  button. The voice comes from the operating system or an installed speech
  engine; the extension ranks the available Chinese voices and honours the
  user's own choice from Settings → Pronunciation. Only on-device voices are
  used unless the user opts into network voices, which are off by default.

No declared required permission was found unused as of this audit.

The v0.5.0 Drift review mode added **no permissions**. It reads the already
saved collection, writes a small local preference record to extension storage,
and makes no network requests of any kind.

## Folder Sync (no extra permission)

Optional encrypted folder sync writes an encrypted replica of the user's data to
a folder the user picks at runtime. It uses the browser's File System Access API
via an explicit directory picker, so it needs no additional manifest permission
and integrates with no provider API. The synchronized payload, including the AI
API key, is encrypted with a user passphrase before it is written. The folder
may live in iCloud Drive, Dropbox, OneDrive, Syncthing, a NAS mount, or a plain
local directory. No developer-operated server is involved. The `alarms`
permission only schedules periodic sync attempts.

## Optional Host Permissions

AI is opt-in. Each origin below is declared as an optional host permission and
requested lazily, only for the provider the user selects, and only when the user
enables AI and uses or tests an AI action (word "Ask AI" insight or quote
"建议填空" cloze suggestions). No host is granted at install time.

- `https://api.deepseek.com/*`: DeepSeek.
- `https://api.openai.com/*`: OpenAI.
- `https://openrouter.ai/*`: OpenRouter (a multi-model proxy; covers models from
  many providers, including Claude, through one OpenAI-compatible host).
- `https://generativelanguage.googleapis.com/*`: Google Gemini
  (OpenAI-compatible endpoint).
- `https://dashscope.aliyuncs.com/*`: Alibaba 通义千问 (Qwen).
- `https://api.moonshot.cn/*`: Moonshot (Kimi).
- `https://open.bigmodel.cn/*`: 智谱 (GLM).

The previous broad `https://*/*` optional host permission and the arbitrary
"custom endpoint" provider were removed. AI provider hosts are now an explicit,
enumerated allow-list. Every listed provider exposes an OpenAI-compatible
`chat/completions` API over HTTPS, so API keys and captured text are never sent
over insecure transport. Users who need a model not directly listed (for example
Claude) can reach it through OpenRouter.

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
pronunciation is requested, the selected saved word is passed to a voice the
browser reports as on-device, so no pronunciation text leaves the computer. Some
platforms additionally offer
network voices, which synthesize speech remotely; these are disabled by default,
and only if the user turns on "Allow network voices" in Settings → Pronunciation
and selects one does the spoken word reach that voice's provider. If the user
enables folder sync, an encrypted replica of their data
(including settings and the AI API key) is written to a folder they choose; the
data is encrypted with the user's passphrase before it leaves the extension and
is never sent to a developer-operated server. The optional full JSON backup also
includes app settings and the AI API key, and is created only when the user
clicks the backup action.

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
