# Changelog

All notable changes to 拾语汉字box are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **Folder sync no longer wipes quote cloze blanks.** Clozes were never
  projected into sync state, while every sync pass overwrote the local inbox
  with the state it materialized — so on a synced profile the first pass
  silently deleted every blank and its per-cloze FSRS scheduling, emptying the
  quote review queue.
- **No more duplicated source occurrences.** When two profiles captured the
  same word independently, sync picked one profile's word id as canonical and
  the other profile then re-filed every one of that word's captures under a
  second identity — showing each source twice. Occurrence identity no longer
  depends on the word id, and existing duplicates collapse on the next sync.
- **Restoring a backup now sticks on a synced profile.** A restore replaces the
  whole inbox, but anything missing from the backup — a word, a quote, a tag, a
  cloze blank, a source occurrence — was only absent, not removed, so the next
  sync pass brought it all back from another device. Restores are also
  authoritative in the other direction now: content the backup carries is
  applied even when the current data is newer, so a restore can undo a deletion
  or an edit (and undo a restore). The restore is applied as a single
  all-or-nothing operation.

### Added

- **Cloze blanks sync between profiles.** Each blank is now a synced node with
  its own span, hint, linked word and review history (one blank = one FSRS
  card), unioned across devices like quote tags and word occurrences. Removing
  a blank writes a tombstone so it stays removed instead of being resurrected
  by a peer. Cloze review history now counts toward the streak and heatmap on
  every device, not just the one it was reviewed on.

## [0.4.5] - 2026-07-26

### Added

- **Optional local CVDICT and AI · VI.** Install CVDICT locally to add Vietnamese
  dictionary definitions alongside the built-in CC-CEDICT and optional Kaikki
  fallback, with matching English and Chinese settings labels and install metadata.

## [0.4.2] - 2026-07-25

### Added

- **Translate a whole quote to English, two ways.** Every quote card now has two
  chips beside 繁: **EN·G** translates through Google's free keyless endpoint,
  and **EN·AI** translates through your configured AI provider. Both results are
  stored on the quote and can be shown at once so you can compare the machine
  and AI phrasing; each chip toggles its own line. Translations reach the daily
  Markdown export as nested bullets, sync between profiles as independent
  fields (so translating with Google on one device and AI on another keeps
  both), and are included in backups. Fully localized (en / zh-CN).
- Google Translate host access is an **optional** permission, requested only the
  first time you click **EN·G**. The Google endpoint is undocumented and
  unsupported by Google; rate limits and outages surface as a retryable message.
- A translation is generated once per source (Google or AI) and is not
  currently regenerable — the chip becomes a show/hide toggle once filled.

## [0.4.1] - 2026-07-04

### Fixed

- **Captures from non-content pages no longer record a bogus source.** Saving a
  word or quote from a blank page (`about:blank`), a New Tab Page
  (`chrome://newtab`, `edge://newtab`, `about:newtab`, `chrome-search://local-ntp`),
  or a browser/extension internal page (`chrome://…`, the extension's own
  `dashboard.html`) previously stored meaningless provenance such as a "New Tab"
  title and a `chrome://newtab/` URL. The word or quote is still saved, but the
  source title, URL, domain, and surrounding sentence are left blank — so the
  occurrence is treated as empty and hidden from source examples. Applies to the
  keyboard shortcut, the context-menu fallback (which fires on exactly these
  restricted pages), and the popup paste-fallback capture.

## [0.4.0] - 2026-07-03

### Added

- Added a **Stats** tab to the dashboard: a review **streak** (with a one-grace-day freeze) as the hero, a 12-week activity heatmap, a 7-day due forecast, and lifetime total reviews. All derived from existing review history; fully localized (en / zh-CN).

## [0.3.0] - 2026-07-03

### Added

- Added a first-run onboarding carousel that introduces capture, word insight, quote practice, review, and export/sync. Reopen it any time from the "How it works" button on the dashboard.

## [0.2.5] - 2026-07-02

### Changed

- **Watercolor UI redesign.** The whole extension moves from the "scholarly ink
  & cinnabar" look to a cozy reading-journal aesthetic: a warm cream palette,
  sage-green accents, large rounded corners, soft low shadows, and hand-drawn
  watercolor foliage. This is purely presentational — no behavior, data, sync,
  or SRS logic changed.
  - **Design tokens.** `styles.css` is rebuilt around cream surfaces
    (`paper`/`card`/`banner`), a sage `accent` scale (replacing every
    `cinnabar-*` token), and a real radius scale (soft cards, pill controls).
    The grid-paper texture is replaced by gentle radial washes, global
    letter-spacing is relaxed, and text selection is sage-tinted.
  - **Dashboard.** The header becomes a greeting hero banner — a time-of-day
    greeting (早安 / 午安 / 晚安 with a friendly sub-line), the localized date,
    the icon as a mascot tile, and the four stat cards folded in as soft chips.
    Tabs become a sage pill segmented control, the toolbar search becomes a
    pill, cards gain round word/quote avatars and pill badges, and the bamboo
    `◇ ◇ ◇` divider is removed.
  - **Popup, settings, and capture toast** inherit the new palette: pill
    buttons, rounded cream cards, a small leaf sprig on the popup, and a
    sage/cream in-page toast.
- **Foliage decoration.** New inline-SVG botanical ornaments (`Foliage.tsx`) —
  sage and autumn branches plus a small sprig — decorate the dashboard hero and
  popup. They are non-interactive, low-opacity, and hidden on narrow viewports.

## [0.2.2] - 2026-07-02

### Fixed

- **Folder sync reauthorization is now one click.** File System Access
  read-write permissions lapse at each browser-session boundary (a browser
  restart or reboot), so folder sync would periodically flip to "Needs
  attention" with `needs-reauthorization` — the gesture-less background alarm
  can detect the lapsed permission but cannot re-grant it. The **Reauthorize**
  button previously forced a full folder re-pick every time; it now asks the
  already-selected folder for permission first (a single click, and silent
  when the browser's persistent permissions apply), falling back to the folder
  picker only when no folder is remembered or the request is denied. On success
  it triggers an immediate sync so the status clears without waiting for the
  next periodic pass.

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

[0.4.1]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.4.1
[0.4.0]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.4.0
[0.3.0]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.3.0
[0.2.5]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.2.5
[0.2.2]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.2.2
[0.2.1]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.2.1
[0.2.0]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.2.0
[0.1.0]: https://github.com/viphat/shiyu-hanzi-box/releases/tag/v0.1.0
