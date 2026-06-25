# Encrypted Provider-Neutral Folder Sync Design

## Summary

Add optional, true bidirectional synchronization for the user-owned state in
拾语汉字box. Each Chrome or Chromium browser profile keeps
`chrome.storage.local` as its fast local database and synchronizes an encrypted
replica through a user-selected folder. The folder may be inside iCloud Drive,
Dropbox, OneDrive, Syncthing, a NAS mount, or an ordinary local directory; the
extension does not integrate with any provider API.

Synchronization is local-first and eventually consistent. Capturing, editing,
reviewing, and changing settings continue to work when the folder or cloud
provider is unavailable. Sync failures never roll back valid local work.

Each extension installation in a browser profile is a separate **replica**.
Two Chrome profiles on one computer, Chrome and Edge on one computer, and
Chrome installations on two computers all participate using distinct replica
IDs.

## Goals

- Synchronize words, quotes, source occurrences, notes, generated annotations,
  SRS state, app settings, and AI settings between browser profiles.
- Merge simultaneous offline edits automatically and deterministically.
- Encrypt the complete synchronized payload, including AI API keys, before it
  reaches the selected folder.
- Remain independent of iCloud, Dropbox, OneDrive, and other provider APIs.
- Preserve the current local-first behavior and existing capture latency.
- Merge pre-existing local data when a profile joins an existing vault.
- Support automatic sync after changes, sync on UI startup, periodic sync while
  an extension page is active, and explicit manual sync.
- Preserve manual JSON backup and restore as an independent recovery path.

## Non-Goals

- Realtime or strongly consistent synchronization.
- A hosted service, account system, OAuth flow, or provider-specific API.
- Sync through `chrome.storage.sync`.
- Synchronizing the imported Kaikki dictionary asset or its IndexedDB index.
- Passphrase recovery or escrow.
- Passphrase rotation in the first version.
- Protecting the remembered key from an attacker who can access the local
  Chrome profile.
- Automatic pruning of old replica files in the first version.
- Supporting browsers without the required File System Access primitives.

## Product Decisions

- `chrome.storage.local` remains authoritative for immediate local use.
- The selected folder is a synchronized replica transport, not the database
  directly used by capture and review flows.
- Conflicts resolve automatically. There is no manual conflict editor.
- The complete sync dataset is encrypted with a user passphrase.
- The derived encryption key is remembered in the local browser profile.
- Existing local and remote datasets merge when a profile first connects.
- AI API keys synchronize inside the encrypted payload.
- Kaikki source URL and source label may synchronize, but Kaikki enablement,
  hash, entry count, import time, file contents, and IndexedDB data remain local
  to each profile.
- Each browser profile writes only its own replica file.

## Architecture

### Local working state

Existing user-facing domain objects remain readable through the current storage
services:

- `local:inbox`
- `local:settings`
- `local:aiSettings`

New sync metadata is stored separately from those domain types. This keeps
`Inbox`, `WordEntry`, `QuoteEntry`, `AppSettings`, and `AiSettings` focused on
the application model instead of exposing synchronization internals to every
consumer.

The sync metadata records:

- Replica ID and optional user-visible replica label.
- A hybrid logical clock for this replica.
- Per-entity and per-field version stamps.
- Stable identities for synchronized collection elements.
- Tombstones for deleted entities and collection elements.
- The last merged canonical state digest.
- Pending-sync state, last attempt, last success, and actionable error state.
- Vault ID associated with this profile.

The selected `FileSystemDirectoryHandle` is structured-cloned into IndexedDB,
because file handles are not JSON values. Folder access remains specific to the
browser profile that received permission.

All local mutations that affect synchronized state must pass through
sync-aware storage services. A background mutation broker is the sole writer
for synchronized storage keys across extension contexts. A mutation updates the
domain value and sync metadata under one serialized broker operation, stamps
both with a shared local revision, then marks sync pending. If the service
worker stops between storage writes, startup reconciliation detects mismatched
revisions, rebuilds metadata from the domain value, and keeps sync pending.
Capture behavior remains funneled through `lib/capture.ts`.

### Folder layout

The user selects a parent directory. The extension creates or opens one
app-owned subdirectory inside it:

```text
拾语汉字box-sync/
  vault.json
  replicas/
    01J...A.shiyu
    01J...B.shiyu
```

`vault.json` is plaintext metadata required to identify and unlock the vault.
It contains no user content or secret:

- App identifier.
- Vault format version.
- Random vault ID.
- KDF algorithm, salt, and work-factor parameters.
- Encryption algorithm identifier.
- An encrypted verification value used to reject an incorrect passphrase
  before replica merging.

Each `.shiyu` file is one authenticated encrypted snapshot containing that
replica's latest converged synchronization state. A profile only writes the file
named by its own replica ID. It may read every valid replica file.

This avoids two active profiles competing to overwrite one shared data file.
The provider may deliver files at different times, but repeated merge passes
converge once all files are locally available.

### Replica identity

A random, stable replica ID is generated for each extension installation within
one browser profile and stored locally. It is unrelated to:

- Physical device identity.
- Google or browser account identity.
- Browser brand.
- Vault identity.

Two profiles on the same device receive different IDs. The same Google Chrome
profile conceptually installed on two devices also receives different IDs
because extension-local state is distinct on each device. Extension updates
preserve the ID. Uninstalling and reinstalling may create a new ID and leave the
old replica file in the folder; stale replica data remains harmless because
field versions and tombstones participate in every merge.

### Scale and storage cost

This design targets a small number of replicas per vault, on the order of a
handful of browser profiles, and a personal-scale dataset of words and quotes.
It is not designed for large teams or very large corpora.

Three costs grow with the dataset and should be understood at design time:

- Per-field version stamps attach a `HybridTimestamp` to every synchronized
  scalar field. The `replicaId` inside each stamp is a repeated string, so
  metadata can rival or exceed the domain data for a large inbox. Replica IDs
  are interned to a small per-replica table referenced by index rather than
  stored inline on every stamp.
- Each sync pass reads and decrypts every replica file and rewrites this
  profile's entire converged state. Cost is proportional to the number of
  replicas multiplied by the full converged state size.
- Tombstones are retained indefinitely, so the converged state grows
  monotonically with deletions.

The extension requests the `unlimitedStorage` permission, because the default
`chrome.storage.local` quota is too small to hold the materialized domain state,
sync metadata, and the remembered key together at the upper end of the intended
scale.

## Synchronized Representation

The encrypted replica contains a versioned synchronization envelope rather than
a raw `Inbox` backup:

```ts
interface SyncReplica {
  app: 'shiyu-hanzi-box';
  formatVersion: 1;
  vaultId: string;
  replicaId: string;
  writtenAt: HybridTimestamp;
  state: SyncState;
}
```

`SyncState` contains materialized user values together with version metadata.
It has independent sections for:

- Word entities keyed by normalized text.
- Quote entities keyed by quote ID.
- Entry tombstones.
- App setting fields.
- AI setting fields.
- Portable Kaikki source configuration.

The synchronized representation supplies stable IDs for occurrences and review
events without requiring those IDs to become visible in the existing UI domain
types. New local mutations generate random stable IDs. Legacy values receive
deterministic IDs derived from their owning entity ID and canonicalized content,
so independently migrated copies of the same data converge.

When sync state is applied locally, a projector materializes the existing
`Inbox`, `AppSettings`, and `AiSettings` shapes. Sync-only IDs, clocks, and
tombstones remain in sync metadata.

## Versioning and Merge

### Hybrid logical timestamps

Every synchronized write receives:

```ts
interface HybridTimestamp {
  wallTime: number;
  counter: number;
  replicaId: string;
}
```

The local clock advances from both the current wall clock and the greatest
remote timestamp observed. Timestamps compare by `wallTime`, then `counter`,
then `replicaId`. The replica ID tie-breaker makes conflict resolution total and
deterministic even when clocks are equal.

The system does not require accurately synchronized physical clocks for
convergence. A badly skewed clock can make that replica's edits win for longer
than expected, so the UI may report extreme clock skew without blocking sync.

### Scalar fields

Mutable scalar fields use per-field last-write-wins registers. Editing one field
does not overwrite a concurrent edit to another field.

Examples include:

- Entry text, note, category, status, pinyin, and Traditional text.
- AI insight as one atomic generated value.
- UI locale and each SRS setting.
- AI enabled state, provider, base URL, API key, and model.
- Portable Kaikki source URL and source label.

`createdAt` takes the earliest valid value. `updatedAt` takes the latest valid
value after merge.

### Words

The logical identity of a word is `word:<normalized>`, matching the existing
capture deduplication rule. If separate profiles create different word IDs for
the same normalized text, they merge into one word.

The canonical public word ID is selected by:

1. Earliest `createdAt`.
2. Lexicographically smallest ID as a tie-breaker.

Occurrences form an observed-remove collection keyed by stable occurrence ID.
Concurrent captures are unioned. Identical legacy occurrences converge through
their deterministic migration IDs.

A legacy occurrence's deterministic ID is derived from its owning word ID plus
the canonicalized tuple of `sourceUrl`, `surrounding`, and `capturedAt`.
Including `capturedAt` means two captures from the same page at different times
remain distinct occurrences, while two independently migrated copies of the
exact same capture converge to one. Captures that share a URL and surrounding
text but differ in capture time are intentionally treated as distinct.

### Quotes

Quotes remain independent and are keyed by their existing entry IDs. No
text-based quote deduplication is introduced. As an accepted consequence, two
profiles that capture the same quote while offline produce two entries with
distinct IDs, and both survive the merge. This differs intentionally from words,
which converge by normalized text, because quotes are freeform and a profile may
legitimately keep near-identical quotes.

### Deletes and restoration

Deleting an entry creates a tombstone at its logical entity key. Removing a
collection member creates a collection-element tombstone. A stale replica
cannot resurrect a deletion.

An intentional later mutation with a timestamp newer than the tombstone may
restore the entry. For words, capturing the normalized word again after its
deletion counts as an intentional restoration and may add a new occurrence.

Tombstones are retained indefinitely in the first version because safe garbage
collection requires knowledge that every replica has observed the deletion.

### Review state

Review log events are unioned by stable event ID and ordered deterministically
by review timestamp, event version, and event ID.

Concurrent offline reviews can produce two scheduler branches. Both review
events remain in history, but the scheduler snapshot associated with the newest
review event wins. Equal event times use hybrid timestamp and replica ID
tie-breakers. The merge layer does not replay FSRS itself, preserving
`lib/srs.ts` as the only importer of `ts-fsrs`.

This rule guarantees convergence and preserves evidence of both reviews, while
accepting that the losing concurrent branch does not affect the final due
snapshot.

The synchronized scheduler snapshot is the subset of `ReviewState` produced by a
review: scheduler identifier, `dueAt`, interval, repetitions, lapses,
`lastReviewedAt`, card state, stability, difficulty, elapsed/scheduled days,
learning step index, and retrievability. These fields move together as one
snapshot tied to the winning review event; they are not independent per-field
registers, because they are jointly computed by a single FSRS step and must stay
internally consistent.

`queueRank` is explicitly **not synchronized**. It is a local ordering artifact
assigned by the fair-queue logic in `lib/srs.ts` and is recomputed locally after
every merge. Two replicas may hold different ranks for the same card without
affecting convergence.

Changing SRS settings recomputes due dates across many cards without producing
review events. The recomputed scheduler values are derived state: they are
recomputed locally after merge from the converged settings and review history,
so they are not propagated as snapshot writes and never conflict across
replicas. Only the SRS setting fields themselves merge as per-field registers
(see Settings).

### Settings

Settings merge by leaf field, not by replacing the entire object. Existing
settings normalization still supplies defaults for values absent from older
replica formats.

Only portable Kaikki fields synchronize:

- `sourceUrl`
- `sourceName`

These remain local:

- `enabled`
- `hash`
- `entryCount`
- `importedAt`
- Imported file contents and the IndexedDB cache

A profile must import its own Kaikki file before enabling the local fallback
dictionary.

### Bootstrap of existing data

Creating the first vault projects the current local state into versioned sync
state.

Joining an existing vault first decrypts and merges remote replicas, then adds
pre-existing local entries:

- Entry field bootstrap versions are derived from existing `updatedAt`.
- Occurrence bootstrap versions are derived from `capturedAt`.
- Review events use `reviewedAt`.
- For an established vault, remote portable app and AI settings win over the
  joining profile's unversioned settings. This prevents a fresh profile's
  defaults from overwriting established configuration; local inbox entries are
  still merged. Because this replaces the joining profile's app and AI settings,
  including any AI provider, base URL, model, and API key already configured in
  that profile, the join flow must warn before joining that local settings will
  be replaced by the vault's settings, and must require explicit confirmation.
- Local-only Kaikki state is preserved.

The converged result is applied locally and written to the joining profile's
new replica file.

## Encryption

### Vault creation

The create flow first checks the selected folder for an existing app-owned
subdirectory and `vault.json`. If one is present, creation is refused and the UI
directs the user to the Join flow instead, so a second profile cannot overwrite
an established vault by choosing Create. Two profiles creating against a truly
empty folder at the same instant is treated as an unsupported setup race; the
later writer wins `vault.json` and the user reconnects.

The first profile:

1. Receives a passphrase twice.
2. Creates a random vault ID.
3. Creates a random 128-bit salt.
4. Derives a 256-bit key using PBKDF2-HMAC-SHA-256 with 600,000 iterations.
5. Encrypts a fixed verification payload with AES-256-GCM.
6. Writes `vault.json`.
7. Writes its first encrypted replica.

PBKDF2-HMAC-SHA-256 is a deliberate version-1 compromise chosen because it is
the strongest key-derivation function natively available in Web Crypto. It is
not memory-hard, so it offers weaker resistance to GPU and ASIC cracking than
Argon2id or scrypt. This matters because the encrypted payload sits in
third-party cloud storage and contains AI API keys, the highest-value secret in
the dataset. KDF and encryption parameters are versioned in `vault.json` so a
future format can adopt a memory-hard KDF, delivered through WebAssembly if
necessary, without silently changing existing vaults. The 600,000-iteration
count is treated as a minimum floor, not a target.

### Replica encryption

Each replica write:

- Canonicalizes and UTF-8 encodes the sync envelope.
- Generates a fresh random 96-bit AES-GCM nonce.
- Encrypts with AES-256-GCM.
- Authenticates immutable header fields such as app ID, format version, vault
  ID, and replica ID as additional authenticated data.

Reusing a nonce with the same key is forbidden. Tests must assert that repeated
writes of identical plaintext produce different ciphertext.

The outer replica file exposes only the versioned encryption header, nonce, and
ciphertext. User text, source URLs, settings, API keys, timestamps, and replica
labels remain encrypted.

### Remembered key and threat model

After a successful unlock, the derived key is stored in
`chrome.storage.local` for that browser profile. The plaintext passphrase is
not stored.

This protects cloud-folder contents from the provider and from someone who
obtains only the synchronized files. It does not protect against an attacker
who can inspect the local Chrome profile or extension storage. The settings UI
must explain this limitation.

The folder still leaks bounded metadata that is not encrypted: the number of
replica files, and, because replica IDs are sortable time-based identifiers, the
approximate creation time of each replica encoded in its filename. No user
content, settings, labels, or secrets are exposed this way. This residual
metadata leak is accepted in the first version.

The user can forget the remembered key without disconnecting the folder. The
next sync then requires the passphrase. A forgotten passphrase cannot be
recovered by the extension.

## Sync Lifecycle

### Serialized coordinator

One coordinator serializes all sync attempts within a profile. It runs in the
background service worker, which is the single context that owns synchronized
writes, so serialization holds as long as triggers route through the worker.
Triggers arriving during an active sync set a rerun flag rather than starting a
competing file operation.

Because the Manifest V3 service worker is suspended aggressively, the coordinator
cannot rely on in-memory timers surviving between events. Debounced and periodic
syncs are scheduled through `chrome.alarms` rather than `setTimeout`, and pending
state is persisted in storage so a sync that was scheduled but not yet run is
recovered when the worker next wakes. The minimum practical alarm period bounds
how short the debounce can be; a mutation that cannot be flushed before the
worker suspends simply remains pending until the next alarm, startup, or manual
trigger.

A sync pass:

1. Load the local sync configuration, directory handle, replica ID, and key.
2. Query read/write permission.
3. Validate `vault.json` and verify the key.
4. Enumerate `replicas/`.
5. Read, authenticate, decrypt, parse, and validate every available compatible
   replica.
6. Merge valid replicas with the current local state.
7. Persist the merged domain state and sync metadata through the background
   mutation broker with one shared local revision. Interrupted writes are
   repaired by startup reconciliation without discarding domain data.
8. Encrypt the canonical converged state.
9. Write this profile's replica with `createWritable()`, considering the write
   successful only after the stream closes.
10. Record success and clear pending state if no newer local mutation arrived.

Unreadable temporary files and unrelated files are ignored. A malformed,
incompatible, or undecryptable `.shiyu` file is not overwritten or deleted; it
is reported as a replica-specific warning.

### Triggers

- Local synchronized mutations set pending state and schedule a short debounced
  sync attempt.
- Opening the dashboard or settings page starts an immediate reconciliation.
- While either page remains active, a periodic reconciliation checks for remote
  changes.
- A manual Sync button starts a reconciliation immediately.
- If an automatic background context cannot access the folder handle, it leaves
  sync pending for the next capable extension context rather than blocking the
  mutation.

The implementation may optionally use file-change observation when available,
but periodic reconciliation remains required and is the portability baseline.

### Folder permission

Folder selection and permission recovery occur only from a user gesture on the
settings page. The handle is retained in IndexedDB and permission is checked
before each pass.

When permission is `prompt` or `denied`, automatic sync stops with a
`needs-reauthorization` status. Local work continues and stays pending. The UI
offers a Reauthorize button.

### Partial cloud hydration

Cloud providers may expose directory entries before their contents are fully
downloaded. Failure to read one replica does not cause the extension to write a
merged state that assumes the replica was deleted. Successfully read replicas
may still merge locally, but the pass remains pending/warning and retries
later.

### File replacement and interruption

The profile writes only its own replica. The write uses
`FileSystemFileHandle.createWritable()` and does not report success before
`close()`. A failed or interrupted write leaves pending state set.

Because providers can still create conflict copies, enumeration accepts only
files whose names exactly match the replica filename grammar. Unexpected
provider conflict files are shown as warnings and never automatically deleted.

## User Interface

### Settings

Add a **Folder Sync** section with these states and controls:

- Unsupported browser explanation when required APIs are absent.
- Create new vault.
- Join existing vault.
- Folder name.
- Editable local replica label.
- Connected vault ID abbreviation.
- Last successful sync.
- Pending change indicator.
- Current status and concise error/warning summary.
- Sync now.
- Reauthorize folder.
- Forget remembered key.
- Disconnect.

Create and join flows require selecting the parent folder and entering the
passphrase. Joining validates the vault before modifying local data, and warns
that the joining profile's existing app and AI settings, including a configured
AI API key, will be replaced by the established vault's settings. Local inbox
entries are merged, not replaced.

The UI warns that:

- A forgotten passphrase cannot be recovered.
- The full synchronized dataset includes AI API keys.
- Remembering the key relies on the security of the local browser profile.
- Sync is eventually consistent rather than instant.

Disconnecting stops sync and removes the directory handle, vault association,
and remembered key from the profile. It preserves all local inbox and settings
data and does not delete any folder contents.

### Dashboard

Add a compact sync status control to the toolbar:

- Disabled.
- Synced.
- Syncing.
- Pending.
- Needs attention.

The control opens or links to Folder Sync settings for detailed recovery.
Routine successful sync stays visually quiet.

### Localization

All new visible strings are added in English and Simplified Chinese through the
existing `lib/i18n.ts` system.

## Backup and Restore

Manual backup remains separate from folder sync.

Introduce a new versioned full backup envelope containing:

- Inbox.
- App settings.
- AI settings, including the API key.

The backup UI must warn that the JSON file contains sensitive data and is not
encrypted. Existing version-1 inbox backups and legacy raw inbox JSON remain
restorable. Any restore is a local synchronized mutation and therefore receives
new local versions and propagates on the next sync. Inbox-only restores leave
current app and AI settings unchanged.

The current Markdown and zip exports remain unchanged and do not gain settings,
sync metadata, tombstones, or AI credentials.

## Error Handling

Errors are categorized into stable user-facing states:

- Unsupported browser.
- Disconnected.
- Locked or forgotten key.
- Wrong passphrase.
- Folder permission required.
- Folder unavailable.
- Vault metadata invalid or unsupported.
- Replica corrupt, incompatible, or not yet hydrated.
- Local validation failure.
- Replica write failure.
- Clock-skew warning.

No sync error prevents capture, review, edit, export, or local settings changes.
Errors preserve pending state. The coordinator never replaces valid local data
with an empty or partially parsed remote value.

## Module Boundaries

The implementation should introduce small pure modules and keep browser APIs at
the edge:

- `lib/sync/types.ts`: persisted sync envelope, versions, statuses, and error
  types.
- `lib/sync/clock.ts`: hybrid logical clock creation, observation, and total
  comparison.
- `lib/sync/merge.ts`: pure deterministic entity and field merging.
- `lib/sync/project.ts`: conversion between domain storage and sync state,
  including legacy bootstrap IDs.
- `lib/sync/crypto.ts`: Web Crypto key derivation, verification, encryption,
  and decryption.
- `lib/sync/vault.ts`: vault and replica parsing/validation.
- `lib/sync/files.ts`: directory-handle traversal and reads/writes.
- `lib/sync/local.ts`: local replica configuration, metadata, and pending
  status.
- `lib/sync/mutations.ts`: revisioned domain-plus-metadata mutation protocol and
  interrupted-write reconciliation.
- `lib/sync/coordinator.ts`: serialized sync orchestration and trigger
  coalescing.
- `entrypoints/background/sync-mutation-handler.ts`: sole-writer message broker
  used by dashboard, settings, popup, and background capture paths.

Existing storage modules remain the application-facing mutation boundary but
delegate synchronized writes to the new local sync transaction layer.

`lib/srs.ts` remains the only importer of `ts-fsrs`. Sync merge consumes and
selects persisted review snapshots; it does not construct a scheduler.

## Testing

### Pure unit tests

- Hybrid timestamp advancement, observation, comparison, and replica
  tie-breaking.
- Per-field last-write-wins merging.
- Merge commutativity, associativity, idempotence, and canonical ordering.
- Word convergence by normalized text.
- Occurrence union and legacy deterministic IDs.
- Quote independence.
- Tombstone suppression and intentional restoration.
- Review event union and winning scheduler snapshot.
- Scheduler snapshot moves as one unit, not as independent per-field registers.
- `queueRank` is not synchronized and is recomputed locally after merge.
- SRS-settings change recomputes due dates locally without producing snapshot
  writes or cross-replica conflicts.
- Joining an established vault replaces local app and AI settings, including the
  API key, while still merging local inbox entries.
- Leaf-level app and AI settings merge.
- Portable versus local-only Kaikki fields.
- Legacy local bootstrap and first-join merge.
- Interrupted local domain/metadata writes and revision reconciliation.

### Encryption tests

- Correct-passphrase round trip.
- Wrong-passphrase rejection.
- Ciphertext tampering and authenticated-header tampering rejection.
- Fresh nonce and different ciphertext for repeated plaintext.
- Vault ID and replica ID mismatch rejection.
- Invalid and unsupported format rejection.

### Coordinator and filesystem tests

- Concurrent triggers serialize into one pass plus at most one rerun.
- Local mutations during a pass remain pending.
- Permission loss and reauthorization.
- Missing folder and invalid vault metadata.
- Partially hydrated or unreadable replica.
- One corrupt replica alongside valid replicas.
- Interrupted or rejected write.
- Conflict-copy filename filtering.
- Create flow refuses a folder that already contains a vault and offers Join.
- Debounced and periodic syncs scheduled through alarms survive a simulated
  service-worker suspension.
- Same-machine browser profiles represented as independent replicas.
- Multiple devices represented as independent replicas.
- Repeated multi-replica passes converge to identical local state.

Filesystem behavior should be tested through a narrow adapter with an in-memory
fake. Manual browser verification covers the real File System Access API.

### Regression and manual verification

Run focused sync, backup, settings, capture, and SRS tests, then:

```bash
npm run compile
npm test
npm run build
```

Manual Chromium verification uses two profiles sharing one ordinary local test
folder:

1. Create a vault in profile A.
2. Capture and review data in A.
3. Join from profile B with pre-existing local entries.
4. Verify merged data and settings in both profiles.
5. Make conflicting offline edits, reconnect, and verify deterministic
   convergence.
6. Remove folder permission and verify local work remains usable and pending.
7. Restore permission and verify convergence.
8. Confirm folder files reveal no user content or AI API key.

## Compatibility and Rollout

Folder Sync is disabled by default. Existing installations continue using their
current local storage with no eager migration.

The settings page feature-detects the File System Access API before offering
connection. Most desktop Chromium browsers support the required primitives,
but the extension must not infer support solely from browser brand.

The initial release uses sync format version 1 and vault format version 1.
Readers reject unknown major formats without modifying files. Additive local
settings continue to use existing normalization behavior.

## Acceptance Criteria

1. Two or more supported browser profiles can select the same provider-synced
   folder, enter the same passphrase, and converge their user data.
2. Profiles never write another profile's replica file.
3. Captures and reviews succeed without folder access.
4. Simultaneous offline changes merge automatically and deterministically.
5. Deleted entries do not reappear from stale replicas.
6. The encrypted folder does not expose captured text, settings, source URLs,
   or AI API keys.
7. Existing local data merges when joining a vault.
8. Folder permission and cloud availability failures preserve valid local data
   and surface actionable status.
9. Kaikki imported data stays local to each profile.
10. Existing inbox-only backups remain restorable.
11. Two profiles on one device and profiles on different devices follow the
    same replica protocol.
12. Compile, full tests, build, and manual two-profile verification pass.

## References

- [Chrome File System Access API](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)
- [Chrome persistent file-system permissions](https://developer.chrome.com/blog/persistent-permissions-for-the-file-system-access-api)
- [Chrome extension storage](https://developer.chrome.com/docs/extensions/reference/api/storage)
- [Web Crypto API](https://www.w3.org/TR/WebCryptoAPI/)
