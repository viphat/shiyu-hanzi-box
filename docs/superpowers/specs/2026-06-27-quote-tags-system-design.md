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
| Sync merge (7) | Add-wins OR-Set: per-tag add stamp + per-tag remove tombstone, mirroring existing `occurrences` / `occurrenceTombstones` + `isSuppressed`. |
| Removal handling | **Approach A** — explicit `removeTags` sync mutation records tombstones, mirroring the existing `deleteQuote → requestSyncMutation('delete')` path. |
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
- `tagCounts(quotes: QuoteEntry[]): Map<string, number>` — frequency map across
  all quotes, used by autocomplete and the Cloud.

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
  tags: Record<string, HybridTimestamp>;        // tag -> add stamp
  tagTombstones: Record<string, HybridTimestamp>; // tag -> remove stamp
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}
```

A tag is **present** during materialize iff
`!isSuppressed(node.tags[tag], node.tagTombstones[tag])` — reusing the existing
`isSuppressed` (tombstone wins on `>=`). Re-adding a removed tag works naturally
because the new add stamp carries a later `wallTime` than the tombstone.

### Projection (`projectQuote`)

```ts
tags: Object.fromEntries(quote.tags.map((tag) => [tag, s])),  // s = stamp(quote.updatedAt, replicaId)
tagTombstones: {},
```

(Tags are already normalized in the inbox, so no re-normalization needed here;
projection may defensively `normalizeTags` to be safe.)

### Merge (`mergeQuoteNodes`)

```ts
tags: mergeStampMap(a.tags, b.tags),
tagTombstones: mergeStampMap(a.tagTombstones, b.tagTombstones),
```

`mergeStampMap` already keeps the max stamp per key (`lib/sync/registers.ts:24`).

### Materialize (`materialize`)

```ts
tags: Object.entries(node.tags)
  .filter(([tag, stamp]) => !isSuppressed(stamp, node.tagTombstones[tag]))
  .map(([tag]) => tag)
  .sort(),
```

Remove the `category` output entirely (drop the `?? 'uncategorized'` default).

### Removal path — Approach A (explicit tombstone mutation)

Why explicit: `runSyncPass` re-projects the whole inbox each pass. A locally
removed tag simply disappears from the projection (empty tombstones), so a
remote replica's add would **resurrect** it. We must record a tombstone, exactly
as entity deletion does.

1. **Mutation kind** — extend `SyncMutationRequestMessage['kind']` with
   `'removeTags'`; payload `{ quoteId: string; tags: string[] }`.
2. **`applyTagRemoval(quoteId, tags)`** in `lib/sync/mutations.ts` — mirrors
   `applyDeletion`: load persisted `SyncState`, stamp
   `state.quotes[quoteId].tagTombstones[tag] = { wallTime: Date.now(), counter: 0, replicaId }`
   for each tag (creating the quote node entry if needed), bump revision, mark
   pending. Uses the same single-writer `chain` as the other mutations.
3. **Handler** (`entrypoints/background/sync-mutation-handler.ts`) routes
   `removeTags` → `applyTagRemoval`.
4. **`mergeQuoteNodes` already carries tombstones forward**, so the next pass:
   re-projects surviving tags (no tombstone) + persisted tombstone suppresses
   the removed tag against any stale remote add; a genuinely newer remote re-add
   still wins (add-wins).

### Dashboard write path

Replace ad-hoc `updateQuote({ tags })` with `setQuoteTags(id, nextTags)` in
`App.tsx`:

1. `next = normalizeTags(nextTags)`.
2. `removed = old.filter((t) => !next.includes(t))`.
3. If `removed.length`, `void requestSyncMutation('removeTags', { quoteId: id, tags: removed })`.
4. `mutate` the inbox: set `tags = next`, bump `updatedAt`.

Adds need no special handling (natural re-projection + union merge).

- **Rename tag X→Y everywhere**: for each quote containing X, `setQuoteTags(quote, addTag(removeTag(quote.tags, X), Y))`. Removal of X fires a tombstone; Y is added naturally.
- **Delete tag everywhere**: for each quote containing it, `setQuoteTags(quote, removeTag(quote.tags, tag))`.

Both are batch loops over the inbox built on the single `setQuoteTags` path.

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

### QuoteList (`entrypoints/dashboard/components/QuoteList.tsx`)

- Add **List | Cloud** sub-tabs (local `view` state).
- **List view**: current grid, plus active tag-filter chips shown above it
  (removable). Keeps the existing parked-quotes toggle.
- **Cloud view** (new `TagCloud` component): renders each tag at a font size
  scaled by its frequency (`tagCounts`). Clicking a tag adds it to the selected
  filter set and switches the sub-tab to List. Each tag has inline
  **rename** and **delete-everywhere** actions (icon buttons / hover menu), each
  guarded by a confirm dialog; these call the batch rename/delete helpers.

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
  - concurrent re-add (newer wallTime) beats a remove → present (add-wins);
  - `mergeStampMap` carries tombstones across passes.
- **`applyTagRemoval`** records tombstones and bumps revision (extend
  `tests/sync/sync-mutation-handler.test.ts`).
- **`setQuoteTags`**: removal fires `removeTags`; add does not; normalization
  applied.
- **Filtering**: OR semantics across multiple selected tags.
- **TagCloud**: frequency counts; click selects + switches view; rename and
  delete-everywhere mutate all matching quotes.
- **QuoteCard component** (`tests/quote-list.test.tsx` or new): chip add/remove,
  autocomplete suggestions, no `category` input present.

## Out of scope (YAGNI)

- Hierarchical / nested tags.
- Per-tag colors or icons.
- Tag-based SRS scheduling.
- A separate Settings-page tag manager (management is inline in the Cloud only).
- AND / toggle filter modes (OR only for now).
