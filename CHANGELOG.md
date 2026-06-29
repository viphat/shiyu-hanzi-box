# Changelog

All notable changes to 拾语汉字box are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.1] - 2026-06-29

### Added

- **Capture confidence.** After saving a word or quote, an in-page toast
  confirms what was captured — "Saved as word", "New occurrence recorded", or
  "Saved as quote" — with a one-click **Undo**. The toast is a self-contained
  Shadow-DOM card injected via the already-granted `scripting` permission
  (no new permissions); Undo reverses the capture through the normal CRDT sync
  pipeline, so deletions are tombstoned and synced like any other edit. The
  popup's paste-fallback capture shows the same confirmation and Undo inline.
  On restricted pages (e.g. `chrome://`) where a toast cannot be injected, the
  toolbar badge still confirms the capture.

### Changed

- **Quotes are de-duplicated on capture.** Saving a quote whose text matches an
  existing one (by normalized text, ignoring whitespace and edge punctuation)
  now surfaces "Already saved" instead of creating a duplicate, leaving the
  existing quote untouched.

## [0.2.0] - 2026-06-28

### Added

- **Quote tags system.** Quotes are now tagged through an inline tag-chip editor
  with autocomplete on each quote card. Tags are normalized (lowercased,
  trimmed, whitespace-collapsed, deduped). The Quotes tab gains List | Cloud
  sub-tabs: the Tags Cloud sizes tags by frequency and supports inline
  rename-everywhere and delete-everywhere, and filtering uses OR semantics
  (a quote matches any selected tag). Tags sync conflict-free as an add-wins
  OR-Set and appear in daily Markdown exports.
- **Encrypted provider-neutral folder sync.** Optional bidirectional sync of
  words, quotes, occurrences, notes, generated annotations, SRS state, app
  settings, and AI settings between browser profiles. Each profile keeps
  `chrome.storage.local` as its authoritative database and synchronizes an
  encrypted replica through a user-selected folder (iCloud Drive, Dropbox,
  OneDrive, Syncthing, a NAS mount, or a plain local directory) via the File
  System Access API — no provider account or API. Sync is local-first,
  eventually consistent, and conflict-free (CRDT merge); it runs on change, on
  UI startup, on a background `alarms` wakeup, and on demand. The whole payload,
  including the AI API key, is encrypted with a user passphrase. A dashboard
  status badge shows Off / Synced / Syncing / Pending / Needs attention, and a
  Folder Sync settings section handles create/join vault, sync now, reauthorize,
  forget key, and disconnect.
- **Full backup (format version 3).** The JSON backup can now bundle app
  settings and AI settings (including the API key) alongside the inbox for a
  complete device-to-device transfer, in addition to the existing inbox-only
  backup (format version 2).

### Changed

- The freeform quote `category` field was **removed** and migrated into `tags`
  on read; the default `uncategorized` category is dropped.
- Added the `alarms` permission to support background folder sync.

## [0.1.0]

Initial release: local-first capture of Chinese words, phrases, and quotes;
offline CC-CEDICT Word Insight panel; pinyin and Simplified → Taiwan Traditional
conversion; one-click Mandarin TTS; FSRS spaced repetition with single-card
review and cloze-deletion quote review; opt-in BYO-key AI insight and cloze
suggestions; optional Kaikki dictionary fallback; English / zh-CN UI; daily
Markdown, zip, and JSON backup exports.

[0.2.1]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.2.1
[0.2.0]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.2.0
[0.1.0]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.1.0
