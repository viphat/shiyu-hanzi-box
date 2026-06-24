# Privacy Policy

Last updated: 2026-06-24

拾语汉字box is a local-first Chrome extension for saving selected Chinese words,
phrases, and quotes while reading.

## Data The Extension Handles

The extension stores the text you explicitly save, your notes, pinyin,
dictionary-derived insights, review state, source page title, source page URL,
source domain, surrounding page context, extension settings, optional AI
settings, and optional imported dictionary data.

The extension does not create an account, does not operate a developer-owned
server, and does not sell user data.

## Local Storage

Saved words, quotes, notes, settings, API keys, generated AI insights, and
runtime dictionary caches are stored locally in your browser through Chrome
extension storage and IndexedDB. You can remove the data by deleting entries in
the extension UI, clearing imported dictionary data in Settings, or uninstalling
the extension.

## Network Requests

The bundled CC-CEDICT dictionary is used offline. External dictionary links open
only when you click them.

AI insight is optional and disabled by default. If you enable it and click an AI
action, the extension sends the saved word, optional pinyin, local dictionary
glosses, and one recent captured occurrence to the AI provider you configured.
Your API key is sent only to that provider. Provider requests use HTTPS.

The optional Kaikki dictionary workflow opens the Kaikki download page in a
normal browser tab when you click the download button. Imported Kaikki JSONL
files are processed locally.

Pronunciation is user-triggered. When you click a speaker button, the extension
passes that saved Chinese word to Chrome's configured text-to-speech engine.
Speech is normally provided by the operating system or an installed Chrome
speech engine. Chrome reports that some installed voices may use a remote
network resource. The extension does not operate its own speech server and does
not store generated audio.

## Permissions

The extension asks for the permissions needed to capture selected text after a
user gesture, store the local inbox, export files, read clipboard text when you
click the paste fallback, pronounce saved Chinese words after you click a
speaker button, and optionally contact AI providers you configure.

## Contact

For questions about this policy, contact the extension publisher through the
Chrome Web Store listing support channel.
