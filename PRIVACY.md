# Privacy Policy

Last updated: 2026-07-25

拾语汉字box is a local-first Chrome extension for saving selected Chinese words,
phrases, and quotes while reading.

## Data The Extension Handles

The extension stores the text you explicitly save, your notes, pinyin,
dictionary-derived insights, quote tags, cloze blanks, quote translations,
review ratings, due dates, scheduling state, review history, source page
title, source page URL, source domain, surrounding page context, extension
settings, optional AI settings (including the optional API key), and
optional imported dictionary data.

The extension does not create an account, does not operate a developer-owned
server, and does not sell user data.

## Local Storage

Saved words, quotes, notes, settings, API keys, generated AI insights, quote
translations, and runtime dictionary caches are stored locally in your
browser through Chrome extension storage and IndexedDB. You can remove the
data by deleting entries in the extension UI, clearing imported dictionary
data in Settings, or uninstalling the extension.

Spaced-repetition ratings and schedules are calculated locally and stored on
the saved entry. They are not sent to a developer-operated service.

## Network Requests

The bundled CC-CEDICT dictionary is used offline. External dictionary links open
only when you click them.

AI features are optional and disabled by default. If you enable AI and click an
AI action, the extension sends data to the AI provider you configured:

- **Ask AI** (word insight) sends the saved word, optional pinyin, local
  dictionary glosses, and one recent captured occurrence.
- **建议填空 / Suggest blanks** (cloze suggestions for a quote) sends that
  quote's sentence text so the provider can propose words to blank out.
- **EN·AI** (quote translation) sends that quote's sentence text so the provider
  can return an English translation.

Your API key is sent only to that provider. Provider requests use HTTPS. When AI
is disabled, the extension makes no AI provider requests.

Quote translation is optional and user-triggered. Each quote card has two
translate buttons; neither runs unless you click it.

- **EN·G** sends that quote's sentence text to Google's translation endpoint at
  `translate.googleapis.com`. This is Google's unofficial keyless translation
  endpoint: no API key, no account, and no sign-in is involved, and the
  extension sends no account, device, or user identifier with the request. As
  with any cross-origin request a browser extension makes, the browser itself
  identifies the extension to Google by its extension ID.
  Because the endpoint is undocumented and unsupported by Google, it may rate-limit
  or stop working; the extension treats any failure as a retryable error. Host
  access to `translate.googleapis.com` is optional and requested only the first
  time you click this button.
- **EN·AI** sends that quote's sentence text to the AI provider you configured,
  under the same terms as the other AI actions above.

Translations are stored locally on the quote and included in Markdown exports
and backups.

The optional Kaikki dictionary workflow opens the Kaikki download page in a
normal browser tab when you click the download button. Imported Kaikki JSONL
files are processed locally.

### Pronunciation (text-to-speech)

Pronunciation uses the speech voices your browser and operating system already
provide. By default the extension only selects voices your browser reports as
on-device, so no pronunciation text leaves your computer.

Some platforms also offer network voices, which synthesize speech on a remote
server. These are disabled by default. If you enable **Allow network voices** in
Settings → Pronunciation and then select one, the word or phrase being spoken is
sent to that voice's provider. No other data is included, and the setting can be
turned off at any time.

## Folder Sync (optional)

Folder sync is optional and disabled by default. When you enable it, the
extension writes an encrypted replica of your data to a folder you select
through the browser's File System Access directory picker. The folder can be any
local or cloud-synced directory you choose (for example iCloud Drive, Dropbox,
OneDrive, Syncthing, a NAS mount, or a plain local directory).

The entire sync payload — including your settings and the optional AI API key —
is encrypted with your passphrase before it leaves the extension. The extension
does not call any cloud provider's API and does not send your data to any
developer-operated server; it only reads and writes files in the folder you
pick. A forgotten passphrase cannot be recovered. The imported Kaikki
dictionary and the locally remembered key are never written to the sync folder.

When sync is enabled, the extension also schedules periodic background sync
attempts so replicas stay in step; no sync activity occurs unless you have
configured sync.

## Exports and Backups

Markdown notes, zip archives, and JSON backups are created only when you click an
explicit export or backup action, and are saved through the browser's download
flow to a location you control. The full JSON backup additionally includes your
app settings and the optional AI API key so you can transfer them to another
device; it is created only on an explicit backup action.

## Permissions

The extension asks for the permissions needed to capture selected text after a
user gesture, store the local inbox, export files, read clipboard text when you
click the paste fallback, pronounce saved Chinese words after you click a
speaker button, schedule periodic background folder-sync attempts when you have
enabled optional folder sync, and optionally contact AI providers you configure.
AI provider host access and Google Translate host access are both optional and
requested only on first use — AI provider access when you enable AI and use or
test a provider, and Google Translate access the first time you click **EN·G**.

## Contact

For questions about this policy, contact the extension publisher through the
Chrome Web Store listing support channel.
