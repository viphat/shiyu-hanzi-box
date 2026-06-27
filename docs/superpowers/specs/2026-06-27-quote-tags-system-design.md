# Quote Tags System — Design

**Date:** 2026-06-27
**Status:** Approved (pending implementation plan)

## Summary

The `QuoteEntry.tags` field exists in the data model, sync, search, and Markdown
export, but has **no UI surface** — it is effectively write-only and nothing
writes to it. There is also a redundant freeform `category` field that overlaps
conceptually with tags.

This project makes tags a first-class feature:

1. Tag-chip editor on each quote card (add / remove).
2. Input normalization (lowercase + trim + collapse whitespace + dedupe).
3. Tag display during review.
4. Autocomplete from the existing tag vocabulary.
5. Tag-based filtering of quotes (OR semantics).
6. **Collapse `category` into `tags`** (option 6c): remove the `category` field;
   migrate existing non-`uncategorized` categories into tags.
7. **Conflict-free tag sync** via an add-wins OR-Set (per-tag add stamp +
   per-tag remove tombstone).
8. Tag management: rename-everywhere / delete-everywhere, inline in the Cloud
   view.
9. **Tags Cloud** as a sub-tab inside the Quotes tab (List | Cloud), sized by
   frequency; clicking a tag filters the List.

## Locked decisions

| Decision | Choice |
| --- | --- |
| Category migration (6c) | Migrate each quote's category into `tags` via `addTag`; **drop** the default `uncategorized`; remove the `category` field entirely. |
| Normalization | Lowercase + trim + collapse internal whitespace; dedupe. One canonical key per tag. Display value == stored value. |
| Sync merge (7) | Add-wins OR-Set: per-tag **stable** add stamp + per-tag remove tombstone, mirroring `occurrences` / `occurrenceTombstones` + `isSuppressed`. |
| Add-stamp stability | **Carry-forward in the sync layer** — projection reuses the persisted add stamp for a tag that already exists (so unrelated quote edits never move it), minting a fresh stamp only for genuinely new tags / re-adds. The local `QuoteEntry.tags` stays `string[]`. |
| Removal handling | **Approach A** — explicit `removeTags` sync mutation records tombstones, mirroring the existing `deleteQuote → requestSyncMutation('delete')` path. |
| Cross-version replicas | Tolerant in-place read migration; `SYNC_FORMAT_VERSION` stays `1`. New code defends against missing `tags`/`tagTombstones` and folds any legacy `fields.tags` register into the OR-Set on read. |
| Tags Cloud placement | Sub-tabs inside the Quotes tab: **List \| Cloud**. Clicking a tag in Cloud switches to List filtered by that tag. |
| Multi-tag filter | **OR** (a quote matches if it has any selected tag). |
| Tag management | Inline in the Cloud view: rename-everywhere and delete-everywhere, each with a confirm. |

## Current state (baseline)

- `QuoteEntry` (`lib/types.ts:82`): has `category: string` and `tags: string[]`.
- Capture (`lib/capture.ts`): new quotes get `tags: []` and a `category`.
- Dashboard `updateQuote` (`entrypoints/dashboard/App.tsx:163`): generic patch;
  no normalization/validation.
- `QuoteCard` (`entrypoints/dashboard/components/QuoteCard.tsx`): renders an
  editable `category` input; **does not render tags**.
- `ReviewQueue` (`…/components/ReviewQueue.tsx:244`): shows a `category` badge.
- Search `entryMatchesQuery` (`App.tsx:372`): joins `tags` + `category` into a
  full-text substring match.
- Markdown export (`lib/markdown.ts:86`): renders `_category:_ <cat> #tag1 #tag2`.
- Backup validation (`lib/backup.ts:120`): requires `isString(category)` and
  `isStringArray(tags)`.
- Sync projection (`lib/sync/project.ts:173`): `tags: reg(quote.tags, s)` — a
  single `Register<string[]>` merged last-write-wins.
- Sync flow (`lib/sync/coordinator.ts:runSyncPass`): re-projects the **entire**
  inbox each pass, merges with persisted state then every remote replica,
  materializes back to the inbox. Deletions use explicit tombstones via
  `applyDeletion` → `deleteEntity` (`lib/sync/mutations.ts:54`,
  `lib/sync/merge.ts:deleteEntity`).

## Section 1 — Data model & normalization

### Type change

`lib/types.ts`: remove `category: string` from `QuoteEntry`. `tags: string[]`
remains the local materialized shape and is always stored normalized + deduped.

### New module `lib/tags.ts`

Pure, dependency-free helpers:

- `normalizeTag(raw: string): string` — trim, collapse internal whitespace to a
  single space, lowercase. Returns `''` for whitespace-only input.
- `normalizeTags(tags: string[]): string[]` — map `normalizeTag`, drop empties,
  dedupe preserving first-seen order.
- `addTag(tags: string[], raw: string): string[]` — normalize and append if not
  already present; returns a new array.
- `removeTag(tags: string[], raw: string): string[]` — normalize and remove;
  returns a new array.
- `tagCounts(quotes: QuoteEntry[]): Map<string, number>` — frequency map over the
  given quote set. Callers pass the relevant scope: autocomplete passes *all*
  quotes; the Cloud passes the `query` + `statusFilter`-visible quotes (see
  Section 3 for each scope).

### Storage migration (category → tags)

Add a WXT versioned migration to `inboxStorage` (`lib/storage.ts`). Bump the
item version and add a migration step that, for every quote:

1. If `category` is present, non-empty, and `normalizeTag(category) !== 'uncategorized'`,
   `addTag(tags, category)`.
2. Delete the `category` property.
3. `tags = normalizeTags(tags)`.

The migration runs once on read. It must be idempotent and tolerate quotes that
already lack `category`.

## Section 2 — Sync (add-wins OR-Set)

### `QuoteNode` shape (`lib/sync/types.ts`)

Remove `tags` from `fields`. Add two maps mirroring the occurrence pattern:

```ts
export interface QuoteNode {
  id: string;
  fields: Record<string, Register<unknown>>;   // no longer holds `tags`
  createdAt: Register<number>;
  tags?: Record<string, HybridTimestamp>;        // tag -> stable add stamp
  tagTombstones?: Record<string, HybridTimestamp>; // tag -> remove stamp
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}
```

Both maps are **optional** so a node authored by an older client (which has
neither) reads back safely — see *Cross-version compatibility* below.

A tag is **present** during materialize iff
`!isSuppressed(node.tags[tag], node.tagTombstones[tag])` — reusing the existing
`isSuppressed` (tombstone wins on `>=`).

### The stable-add-stamp requirement (must-fix)

The occurrence OR-Set is correct only because each occurrence carries its own
**immutable** stamp (`occ.capturedAt`, `project.ts:140`): an add stamp that
never moves stays beaten by a later tombstone forever. `QuoteEntry.tags` is a
plain `string[]` with no per-tag timestamp, so naively stamping every tag with
the shared, mutable `quote.updatedAt` is **broken**: any unrelated edit (note,
status, text) on a replica that still holds a tag bumps that tag's add stamp
past an existing tombstone and **resurrects** the deleted tag. Routine
two-device usage triggers it (delete on A; later edit the same quote's note on
B → tag comes back).

**Fix — carry-forward the add stamp in the sync layer.** Projection reuses the
persisted add stamp for a tag that already exists, and mints a fresh stamp only
for a genuinely new tag (or a re-add over a tombstone). `QuoteEntry.tags` stays
`string[]`; all OR-Set state and logic live in the sync layer. `projectInbox`
gains access to the persisted `SyncState` (it is already in scope in
`runSyncPass` and `reconcileOnStartup`; passed in, defaulting to `undefined`
for first-time bootstrap).

### Projection (`projectQuote(quote, ctx, prev?)`)

`prev` is the persisted `QuoteNode` for this quote id (or `undefined`). For each
normalized local tag:

```ts
const prevAdd = prev?.tags?.[tag];
const prevTomb = prev?.tagTombstones?.[tag];
const stillPresent = prevAdd && !isSuppressed(prevAdd, prevTomb);
const addStamp = stillPresent
  ? prevAdd                                   // carry forward — never moves on unrelated edits
  : stamp(Math.max(quote.updatedAt, (prevTomb?.wallTime ?? 0) + 1), ctx.replicaId); // new / re-add, guaranteed > any prior tombstone
```

`tagTombstones` projects as `{}` (removals are recorded only via the explicit
mutation below, never inferred from projection). Carrying `prevTomb.wallTime + 1`
into a re-add stamp also closes the same-millisecond re-add race (a re-add can
never tie-or-lose to the tombstone it supersedes).

### Merge (`mergeQuoteNodes`)

```ts
tags: mergeStampMap(a.tags ?? {}, b.tags ?? {}),
tagTombstones: mergeStampMap(a.tagTombstones ?? {}, b.tagTombstones ?? {}),
```

`mergeStampMap` keeps the max stamp per key (`lib/sync/registers.ts:24`). Inputs
are first passed through `liftLegacyTags` (below).

### Materialize (`materialize`)

```ts
const node2 = liftLegacyTags(node);
tags: Object.entries(node2.tags ?? {})
  .filter(([tag, stamp]) => !isSuppressed(stamp, node2.tagTombstones?.[tag]))
  .map(([tag]) => tag)
  .sort(),
```

Remove the `category` output entirely (drop the `?? 'uncategorized'` default).

### Cross-version compatibility (rollout)

Devices upgrade asynchronously, so the new code must read replica files written
by the old version. `SYNC_FORMAT_VERSION` stays `1` (bumping it would make old
replicas `replica-incompatible` and reject *all* their data, not just tags). A
tolerant in-place read migration handles it:

- **Crash safety:** all reads use `node.tags ?? {}` / `node.tagTombstones ?? {}`.
- **`liftLegacyTags(node)`** (applied at the top of both `mergeQuoteNodes` and
  `materialize`, since a quote present only in a remote node is copied by
  `mergeNodeMap` without a per-node merge): if `node.tags` is absent/empty and a
  legacy `node.fields.tags` register exists, build `tags` from that register's
  value, each stamped with the register's stamp; then it can ignore
  `fields.tags`. This makes tags added on a not-yet-upgraded device appear on
  upgraded devices with no data loss.
- **Known limitation:** new devices stop writing `fields.tags`, so a
  not-yet-upgraded device won't *see* tags managed by an upgraded device until
  it upgrades. No data is lost (it lives in the new maps); it is only invisible
  on stale clients during the rollout window. Acceptable for a personal
  extension. (We deliberately do **not** dual-write `fields.tags`, which would
  let an old device's LWW register resurrect deleted tags.)

### Removal path — Approach A (explicit tombstone mutation)

Why explicit: `runSyncPass` re-projects the whole inbox each pass. A locally
removed tag simply disappears from the projection (empty tombstones), so a
remote replica's add would **resurrect** it. We must record a tombstone, exactly
as entity deletion does.

1. **Mutation kind** — extend `SyncMutationRequestMessage['kind']` with
   `'removeTags'`; payload is a **batch**:
   `{ removals: Array<{ quoteId: string; tags: string[] }> }`. A single
   tag removal sends a one-element array; rename/delete-everywhere send N.
2. **`applyTagRemoval(removals)`** in `lib/sync/mutations.ts` — mirrors
   `applyDeletion`: load persisted `SyncState`, and for each `{quoteId, tags}`
   stamp `state.quotes[quoteId].tagTombstones[tag] = { wallTime: Date.now(), counter: 0, replicaId }`
   (creating the quote node and its `tagTombstones` map if needed), then bump
   revision once and mark pending. Uses the same single-writer `chain`.
3. **Handler** (`entrypoints/background/sync-mutation-handler.ts`) routes
   `removeTags` → `applyTagRemoval`.
4. **After the Merge change above**, `mergeQuoteNodes` carries tombstones
   forward, so the next pass: re-projects surviving tags (carry-forward add
   stamps) while the persisted tombstone suppresses the removed tag against any
   stale remote add; a genuinely newer remote re-add still wins (add-wins).

### Dashboard write path

Replace ad-hoc `updateQuote({ tags })` with `setQuoteTags(id, nextTags)` in
`App.tsx`:

1. `next = normalizeTags(nextTags)`.
2. `removed = old.filter((t) => !next.includes(t))`.
3. If `removed.length`, `void requestSyncMutation('removeTags', { removals: [{ quoteId: id, tags: removed }] })`.
4. `mutate` the inbox: set `tags = next`, bump `updatedAt`.

Adds need no special handling (carry-forward projection + union merge).

- **Rename tag X→Y everywhere**: compute the new `tags` per matching quote
  (`addTag(removeTag(quote.tags, X), Y)`), write the inbox in one `mutate`, and
  fire **one** batched `removeTags` mutation collecting `X` across all matching
  quotes. Y is added naturally.
- **Delete tag everywhere**: write the inbox in one `mutate` and fire **one**
  batched `removeTags` mutation collecting the tag across all matching quotes.

Both run as a single inbox `mutate` + a single batched sync mutation (not O(N)
serialized writes through the `chain`).

## Section 3 — UI

### QuoteCard (`entrypoints/dashboard/components/QuoteCard.tsx`)

- Remove the `category` `<input>`.
- Add a **tag-chip editor**: existing tags render as chips with an `×` remove
  button; a text input commits a new tag on Enter or comma (and on blur if
  non-empty). All writes go through the card's `onUpdate`-equivalent that calls
  `setQuoteTags`.
- **Autocomplete**: a datalist/suggestion dropdown sourced from a memoized
  `tagCounts(inbox.quotes)` (passed down as a prop, e.g. `knownTags: string[]`),
  filtered by the current input and excluding already-applied tags.
  **Scope:** autocomplete uses the **full** vocabulary across *all* quotes
  (every status, parked included) so any existing tag can be reused.

### QuoteList (`entrypoints/dashboard/components/QuoteList.tsx`)

- Add **List | Cloud** sub-tabs (local `view` state).
- **List view**: current grid, plus active tag-filter chips shown above it
  (removable). Keeps the existing parked-quotes toggle.
- **Cloud view** (new `TagCloud` component): renders each tag at a font size
  scaled by its frequency. Clicking a tag adds it to the selected
  filter set and switches the sub-tab to List. Each tag has inline
  **rename** and **delete-everywhere** actions (icon buttons / hover menu), each
  guarded by a confirm dialog; these call the batch rename/delete helpers.
  **Scope:** the Cloud counts the quotes currently visible under the active
  `query` + `statusFilter` (i.e. the same set the List shows) but **ignores the
  active tag filter** (so selecting a tag never collapses the cloud). Parked
  quotes are included. This keeps a clicked tag's apparent count consistent with
  what the filtered List then displays.

### Filtering (`App.tsx`)

- New state `selectedTags: Set<string>` (OR semantics), lifted to `App` so it
  composes with `query` and `statusFilter` in the `matches` memo.
- A quote matches when:
  `entryMatchesQuery(quote, query) AND byStatus(quote.status) AND (selectedTags.size === 0 OR quote.tags.some((t) => selectedTags.has(t)))`.
- Selected-tag chips also rendered in the QuoteList List header for removal.

### ReviewQueue (`…/components/ReviewQueue.tsx`)

- Replace the single `category` badge with tag badges (render `quote.tags` as
  small chips; render nothing if empty).

### Search / export / backup

- `entryMatchesQuery` (`App.tsx:372`): drop `category` from the source string;
  keep `tags.join(' ')`.
- `lib/markdown.ts:86`: drop the `_category:_` segment; keep `#tag` rendering.
  If a quote has no tags, omit the line entirely (or render just the source).
- `lib/backup.ts`:
  - `isQuoteEntry`: drop the `isString(value.category)` requirement; keep
    `isStringArray(value.tags)`.
  - On restore, run the same category→tags migration so older backups (which
    still carry `category`) fold cleanly and end up normalized.

## Section 4 — Testing (Vitest)

- **`lib/tags.ts`**: `normalizeTag` (case/whitespace/empty), `normalizeTags`
  dedupe + order, `addTag`/`removeTag` idempotence, `tagCounts`.
- **Migration**: category→tags for storage (incl. `uncategorized` dropped,
  duplicates collapsed) and for backup restore of an old-format quote.
- **OR-Set sync** (extend `tests/sync/*`):
  - concurrent add on two replicas → both tags survive;
  - remove vs a stale add it causally saw → suppressed;
  - **resurrection regression (the must-fix):** remove tag on A, then an
    *unrelated* field edit (note/status) on B that still holds the tag, then
    merge → tag stays removed. (The "stale add it causally saw" case alone would
    pass even with the bug, so this distinct case is required.)
  - add-stamp stability: an unrelated edit on a quote does **not** move a tag's
    persisted add stamp (carry-forward);
  - concurrent re-add beats a remove → present (add-wins), including the
    same-millisecond re-add (re-add stamp uses `tombstone.wallTime + 1`);
  - `mergeStampMap` carries tombstones across passes.
- **Cross-version compatibility:** a `QuoteNode` with no `tags`/`tagTombstones`
  reads back without throwing; `liftLegacyTags` folds a legacy `fields.tags`
  register (incl. a quote present only in a remote node, copied by
  `mergeNodeMap`) into the OR-Set.
- **`applyTagRemoval`** records tombstones for a batched multi-quote payload and
  bumps revision once (extend `tests/sync/sync-mutation-handler.test.ts`).
- **`setQuoteTags`**: removal fires `removeTags`; add does not; normalization
  applied.
- **Filtering**: OR semantics across multiple selected tags.
- **TagCloud**: frequency counts (visible set, parked included, tag filter
  ignored); click selects + switches view; rename and delete-everywhere mutate
  all matching quotes via a single inbox `mutate` + one batched `removeTags`.
- **QuoteCard component** (`tests/quote-list.test.tsx` or new): chip add/remove,
  autocomplete suggestions, no `category` input present.

## Out of scope (YAGNI)

- Hierarchical / nested tags.
- Per-tag colors or icons.
- Tag-based SRS scheduling.
- A separate Settings-page tag manager (management is inline in the Cloud only).
- AND / toggle filter modes (OR only for now).
