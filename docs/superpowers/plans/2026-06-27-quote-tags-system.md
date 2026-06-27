# Quote Tags System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `QuoteEntry.tags` a first-class feature — chip editor, autocomplete, filtering, a tags cloud — and collapse the redundant `category` field into tags, with conflict-free add-wins OR-Set sync.

**Architecture:** A pure `lib/tags.ts` owns normalization and the small functional helpers. The local model keeps `tags: string[]`; all CRDT state (per-tag add stamp + remove tombstone) lives in the sync layer, mirroring the existing `occurrences`/`occurrenceTombstones` pattern. Add-stamp stability is achieved by *carrying forward* the persisted add stamp during projection so unrelated quote edits never resurrect a deleted tag. Removals are recorded by an explicit `removeTags` sync mutation (mirroring `deleteQuote → applyDeletion`). The `category` field is removed end-to-end and migrated into tags on storage read and on backup restore.

**Tech Stack:** TypeScript, WXT (browser-extension framework + `storage.defineItem`), React 19, Vitest, Tailwind. Sync state is an encrypted, provider-neutral folder of per-replica replica files merged via wall-time LWW.

## Prerequisite — durable persisted `SyncState` (satisfied)

The carry-forward design requires the persisted `SyncState` (tombstones + per-tag
add stamps) to survive a normal dashboard edit, so `projectInbox` receives a
non-null `prev` on every pass after the first. **This is now guaranteed** by
commit `7a5afcc` ("preserve persisted SyncState on local writes so deletions
survive"): `applyLocalMutation` / `applyLocalMutationIfUnchanged` carry
`meta.state` forward (revision bump only — no `state: null`), and
`reconcileOnStartup` merges any existing tombstones when it rebuilds from the
domain.

> This supersedes the earlier reasoning that inbox edits "never null the sync
> state because the UI writes `inboxStorage` directly." Since commit `06a5332`
> the UI *does* route every inbox edit through `requestSyncMutation('inbox', …)`
> → `applyLocalMutation`; durability now comes from that function preserving
> state, not from the UI bypassing the broker. Regression coverage lives in
> `tests/sync/write-path-tombstone-loss.test.ts` (delete-then-edit must not
> resurrect; the planned `removeTags`-then-`mutate` shares the shape).

`prev` is therefore `undefined` only on a genuine first-time bootstrap (no
tombstones yet), where minting fresh add stamps from `updatedAt` resurrects
nothing.

## Global Constraints

- **Normalization (one canonical key per tag):** lowercase + trim + collapse internal whitespace to a single space + dedupe. Display value == stored value. Verbatim from spec §"Locked decisions".
- **`uncategorized` is dropped:** a quote whose only category is `uncategorized` contributes no tag.
- **Multi-tag filter is OR:** a quote matches if it has *any* selected tag.
- **`SYNC_FORMAT_VERSION` stays `1`** — never bump it (bumping marks old replicas `replica-incompatible` and rejects all their data). Cross-version handling is a tolerant in-place read migration.
- **No dual-write of `fields.tags`** — once new code manages a quote's tags it never writes the legacy `fields.tags` register (doing so would let an old device's LWW register resurrect deleted tags).
- **Add stamps must never move on unrelated edits** — projection carries forward the persisted add stamp for an already-present tag; a fresh stamp is minted only for a genuinely new tag or a re-add.
- **Conflict model:** wall-time LWW via `compareTimestamps` (wallTime → counter → replicaId); tombstone wins ties (`isSuppressed` uses `>=`). This is the accepted, existing model — do not introduce the HLC.
- **Tooling:** run a single test file with `npx vitest run <path>`; run one test by name with `npx vitest run <path> -t "<name>"`; typecheck with `npm run compile`.
- **i18n parity:** every key added to the `en` block of `lib/i18n.ts` must also be added to the `zh-CN` block, or `tests/i18n-source.test.ts` fails.

---

## File Structure

**New files:**
- `lib/tags.ts` — pure tag helpers: `normalizeTag`, `normalizeTags`, `addTag`, `removeTag`, `tagCounts`, `planTagWrite`, `migrateQuoteCategoryToTags`. No imports beyond `./types`.
- `tests/tags.test.ts` — unit tests for `lib/tags.ts`.
- `entrypoints/dashboard/components/TagCloud.tsx` — the Cloud sub-view with inline rename/delete-everywhere.
- `tests/tag-cloud.test.tsx` — component tests for `TagCloud`.

**Modified files:**
- `lib/types.ts` — remove `category` from `QuoteEntry`.
- `lib/storage.ts` — version `inboxStorage`, add the category→tags migration.
- `lib/capture.ts` — new quotes no longer set `category`.
- `lib/markdown.ts` — drop the `_category:_` segment.
- `lib/backup.ts` — drop the `category` validation; migrate on restore.
- `lib/sync/types.ts` — add `tags?` / `tagTombstones?` maps to `QuoteNode`.
- `lib/sync/project.ts` — `projectQuote` carry-forward; `materialize` reads the OR-Set + `liftLegacyTags`; drop `category`.
- `lib/sync/merge.ts` — `mergeQuoteNodes` merges the two stamp maps via `liftLegacyTags`.
- `lib/sync/mutations.ts` — `applyTagRemoval` (batched).
- `lib/sync/coordinator.ts` — pass `persisted` into `projectInbox`.
- `entrypoints/background/sync-mutation-handler.ts` — `removeTags` kind → `applyTagRemoval`.
- `entrypoints/dashboard/App.tsx` — `setQuoteTags`, rename/delete-everywhere, `selectedTags` filtering, drop `category` from search; plumb props to `QuoteList`.
- `entrypoints/dashboard/components/QuoteCard.tsx` — remove category input; add tag-chip editor + autocomplete.
- `entrypoints/dashboard/components/QuoteList.tsx` — List|Cloud sub-tabs, filter chips.
- `entrypoints/dashboard/components/ReviewQueue.tsx` — category badge → tag badges.
- `lib/i18n.ts` — new UI strings.
- Tests under `tests/` and `tests/sync/` extended per task.

---

## Task 1: `lib/tags.ts` pure helpers

**Files:**
- Create: `lib/tags.ts`
- Test: `tests/tags.test.ts`

**Interfaces:**
- Consumes: `QuoteEntry` from `lib/types` (still has `category` at this point — `migrateQuoteCategoryToTags` reads it via a widened type).
- Produces:
  - `normalizeTag(raw: string): string`
  - `normalizeTags(tags: string[]): string[]`
  - `addTag(tags: string[], raw: string): string[]`
  - `removeTag(tags: string[], raw: string): string[]`
  - `tagCounts(quotes: QuoteEntry[]): Map<string, number>`
  - `planTagWrite(old: string[], nextRaw: string[]): { next: string[]; removed: string[] }`
  - `migrateQuoteCategoryToTags<T extends { category?: string; tags?: string[] }>(quote: T): Omit<T, 'category'> & { tags: string[] }`

- [ ] **Step 1: Write the failing tests**

Create `tests/tags.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  addTag,
  migrateQuoteCategoryToTags,
  normalizeTag,
  normalizeTags,
  planTagWrite,
  removeTag,
  tagCounts,
} from '../lib/tags';
import type { QuoteEntry } from '../lib/types';

function quote(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: over.id ?? 'q1',
    kind: 'quote',
    text: 't',
    note: '',
    status: 'inbox',
    category: 'uncategorized',
    tags: [],
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...over,
  } as QuoteEntry;
}

describe('normalizeTag', () => {
  it('lowercases, trims, and collapses internal whitespace', () => {
    expect(normalizeTag('  Hello   World  ')).toBe('hello world');
  });
  it('returns empty string for whitespace-only input', () => {
    expect(normalizeTag('   ')).toBe('');
  });
});

describe('normalizeTags', () => {
  it('drops empties and dedupes preserving first-seen order', () => {
    expect(normalizeTags(['B', 'a', '  ', 'b', 'A'])).toEqual(['b', 'a']);
  });
});

describe('addTag / removeTag', () => {
  it('addTag appends normalized, idempotent', () => {
    expect(addTag(['a'], 'B')).toEqual(['a', 'b']);
    expect(addTag(['a', 'b'], ' B ')).toEqual(['a', 'b']);
  });
  it('removeTag removes normalized, idempotent', () => {
    expect(removeTag(['a', 'b'], 'B')).toEqual(['a']);
    expect(removeTag(['a'], 'z')).toEqual(['a']);
  });
  it('returns new arrays (no mutation)', () => {
    const src = ['a'];
    addTag(src, 'b');
    removeTag(src, 'a');
    expect(src).toEqual(['a']);
  });
});

describe('tagCounts', () => {
  it('counts frequency across quotes', () => {
    const counts = tagCounts([
      quote({ id: 'q1', tags: ['a', 'b'] }),
      quote({ id: 'q2', tags: ['a'] }),
    ]);
    expect(counts.get('a')).toBe(2);
    expect(counts.get('b')).toBe(1);
  });
});

describe('planTagWrite', () => {
  it('normalizes next and reports removed tags', () => {
    expect(planTagWrite(['a', 'b'], ['A', 'C'])).toEqual({
      next: ['a', 'c'],
      removed: ['b'],
    });
  });
  it('reports no removals on a pure add', () => {
    expect(planTagWrite(['a'], ['a', 'b'])).toEqual({
      next: ['a', 'b'],
      removed: [],
    });
  });
});

describe('migrateQuoteCategoryToTags', () => {
  it('folds a non-uncategorized category into tags and drops the field', () => {
    const out = migrateQuoteCategoryToTags(quote({ category: 'Poetry', tags: ['a'] }));
    expect(out.tags).toEqual(['a', 'poetry']);
    expect('category' in out).toBe(false);
  });
  it('drops uncategorized without adding a tag', () => {
    const out = migrateQuoteCategoryToTags(quote({ category: 'uncategorized', tags: ['a'] }));
    expect(out.tags).toEqual(['a']);
  });
  it('is idempotent and tolerates a missing category', () => {
    const once = migrateQuoteCategoryToTags(quote({ category: 'Poetry', tags: [] }));
    const twice = migrateQuoteCategoryToTags(once);
    expect(twice.tags).toEqual(['poetry']);
    const noCat = migrateQuoteCategoryToTags({ tags: ['x'] });
    expect(noCat.tags).toEqual(['x']);
  });
  it('collapses a category that duplicates an existing tag', () => {
    const out = migrateQuoteCategoryToTags(quote({ category: 'Poetry', tags: ['poetry'] }));
    expect(out.tags).toEqual(['poetry']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tags.test.ts`
Expected: FAIL — `Cannot find module '../lib/tags'`.

- [ ] **Step 3: Implement `lib/tags.ts`**

Create `lib/tags.ts`:

```ts
import type { QuoteEntry } from './types';

/** Trim, collapse internal whitespace to a single space, lowercase. */
export function normalizeTag(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Normalize each tag, drop empties, dedupe preserving first-seen order. */
export function normalizeTags(tags: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of tags) {
    const tag = normalizeTag(raw);
    if (tag === '' || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
  }
  return out;
}

/** Normalize and append `raw` if not already present. Returns a new array. */
export function addTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  if (tag === '' || tags.includes(tag)) return [...tags];
  return [...tags, tag];
}

/** Normalize and remove `raw`. Returns a new array. */
export function removeTag(tags: string[], raw: string): string[] {
  const tag = normalizeTag(raw);
  return tags.filter((t) => t !== tag);
}

/** Frequency map of normalized tags across the given quotes. */
export function tagCounts(quotes: QuoteEntry[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const quote of quotes) {
    for (const tag of quote.tags) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return counts;
}

/**
 * Plan a tag write: normalize the requested next set and compute which of the
 * old tags were removed (so the caller can fire a `removeTags` mutation).
 */
export function planTagWrite(
  old: string[],
  nextRaw: string[],
): { next: string[]; removed: string[] } {
  const next = normalizeTags(nextRaw);
  const removed = old.filter((t) => !next.includes(t));
  return { next, removed };
}

/**
 * Fold a quote's freeform `category` into `tags` and drop the `category` field.
 * Idempotent; tolerates quotes that already lack `category`. The default
 * `uncategorized` contributes no tag.
 */
export function migrateQuoteCategoryToTags<
  T extends { category?: string; tags?: string[] },
>(quote: T): Omit<T, 'category'> & { tags: string[] } {
  const { category, ...rest } = quote;
  let tags = rest.tags ?? [];
  if (category && normalizeTag(category) !== 'uncategorized') {
    tags = addTag(tags, category);
  }
  return { ...(rest as Omit<T, 'category'>), tags: normalizeTags(tags) };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tags.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add lib/tags.ts tests/tags.test.ts
git commit -m "feat(tags): add pure tag helpers (normalize, add/remove, counts, migrate)"
```

---

## Task 2: Storage migration (category → tags)

**Files:**
- Modify: `lib/storage.ts:5-7`
- Test: `tests/tags.test.ts` (extend) or new `tests/storage-migration.test.ts`

**Interfaces:**
- Consumes: `migrateQuoteCategoryToTags` from `lib/tags`.
- Produces: `migrateInboxV1ToV2(old: unknown): Inbox` (exported, pure, unit-testable) wired as the WXT `migrations[2]` step on `inboxStorage`.

- [ ] **Step 1: Write the failing test**

Create `tests/storage-migration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { migrateInboxV1ToV2 } from '../lib/storage';

describe('migrateInboxV1ToV2', () => {
  it('folds category into tags, drops uncategorized, dedupes, removes category', () => {
    const out = migrateInboxV1ToV2({
      words: [{ id: 'w', kind: 'word' }],
      quotes: [
        { id: 'q1', kind: 'quote', category: 'Poetry', tags: ['poetry', 'A'] },
        { id: 'q2', kind: 'quote', category: 'uncategorized', tags: ['b'] },
        { id: 'q3', kind: 'quote', category: 'News', tags: [] },
      ],
    });
    expect(out.quotes[0].tags).toEqual(['poetry', 'a']);
    expect('category' in out.quotes[0]).toBe(false);
    expect(out.quotes[1].tags).toEqual(['b']);
    expect(out.quotes[2].tags).toEqual(['news']);
    // Words are untouched.
    expect(out.words[0]).toEqual({ id: 'w', kind: 'word' });
  });

  it('tolerates quotes already lacking category (idempotent)', () => {
    const once = migrateInboxV1ToV2({ words: [], quotes: [{ id: 'q', kind: 'quote', category: 'X', tags: [] }] });
    const twice = migrateInboxV1ToV2(once);
    expect(twice.quotes[0].tags).toEqual(['x']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/storage-migration.test.ts`
Expected: FAIL — `migrateInboxV1ToV2` is not exported.

- [ ] **Step 3: Implement the migration in `lib/storage.ts`**

Replace the file's top (`lib/storage.ts:1-7`) with:

```ts
import { storage } from 'wxt/utils/storage';
import type { Inbox, QuoteEntry } from './types';
import { EMPTY_INBOX } from './types';
import { migrateQuoteCategoryToTags } from './tags';

/**
 * v1 → v2: collapse the freeform `category` field into `tags`. Pure and
 * idempotent so it is safe whether or not a quote still carries `category`.
 * Exported for unit testing; wired as the WXT `migrations[2]` step below.
 */
export function migrateInboxV1ToV2(old: unknown): Inbox {
  const value = (old ?? {}) as { words?: unknown[]; quotes?: unknown[] };
  return {
    words: (value.words ?? []) as Inbox['words'],
    quotes: ((value.quotes ?? []) as Array<{ category?: string; tags?: string[] }>).map(
      (quote) => migrateQuoteCategoryToTags(quote) as unknown as QuoteEntry,
    ),
  };
}

export const inboxStorage = storage.defineItem<Inbox>('local:inbox', {
  fallback: EMPTY_INBOX,
  version: 2,
  migrations: {
    2: (old: unknown): Inbox => migrateInboxV1ToV2(old),
  },
});
```

(Leave the rest of `lib/storage.ts` — `getInbox`, `setInbox`, `mutateInbox` — unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/storage-migration.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck**

Run: `npm run compile`
Expected: No errors. (At this point `QuoteEntry.category` still exists, so `migrateQuoteCategoryToTags` typing against the still-present field is fine.)

- [ ] **Step 6: Commit**

```bash
git add lib/storage.ts tests/storage-migration.test.ts
git commit -m "feat(storage): migrate quote category into tags on read (inbox v2)"
```

---

## Task 3: Sync OR-Set (projection carry-forward, merge, materialize, legacy lift)

**Files:**
- Modify: `lib/sync/types.ts:60-66`
- Modify: `lib/sync/project.ts` (`projectQuote`, `projectInbox`, `materialize`; add `liftLegacyTags`)
- Modify: `lib/sync/merge.ts:97-106` (`mergeQuoteNodes`)
- Modify: `lib/sync/coordinator.ts:29-32` (pass `persisted`)
- Test: `tests/sync/project.test.ts`, `tests/sync/merge.test.ts`

**Interfaces:**
- Consumes: `HybridTimestamp`, `Register`, `isSuppressed`, `mergeStampMap`, `compareTimestamps`, `EMPTY_SYNC_STATE`.
- Produces:
  - `QuoteNode.tags?: Record<string, HybridTimestamp>` and `QuoteNode.tagTombstones?: Record<string, HybridTimestamp>`.
  - `projectQuote(quote, ctx, prev?: QuoteNode)` carry-forward semantics.
  - `projectInbox(inbox, settings, ai, ctx, persisted?: SyncState)`.
  - `liftLegacyTags(node: QuoteNode): QuoteNode` (exported from `lib/sync/project.ts`).
  - `materialize` emits `tags` from the OR-Set (still emits `category` until Task 5).

> Note: this task keeps the existing `category` register and `materialize` category output intact (they are removed in Task 5). It only moves `tags` from a single LWW register to the OR-Set.

- [ ] **Step 1: Add the maps to `QuoteNode`**

In `lib/sync/types.ts`, replace the `QuoteNode` interface (lines 60-66):

```ts
export interface QuoteNode {
  id: string;
  fields: Record<string, Register<unknown>>;   // no longer holds `tags`
  createdAt: Register<number>;
  /** tag -> stable add stamp. Optional so older replicas read back safely. */
  tags?: Record<string, HybridTimestamp>;
  /** tag -> remove stamp. */
  tagTombstones?: Record<string, HybridTimestamp>;
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}
```

- [ ] **Step 2: Write the failing projection/materialize tests**

Add to `tests/sync/project.test.ts`:

```ts
import { materialize, projectInbox, liftLegacyTags } from '../../lib/sync/project';
import type { QuoteEntry } from '../../lib/types';
import type { SyncState } from '../../lib/sync/types';

function quoteFixture(over: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: 'hi',
    note: '',
    status: 'inbox',
    category: 'uncategorized',
    tags: [],
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    ...over,
  } as QuoteEntry;
}

function project(inbox: { quotes: QuoteEntry[] }, persisted?: SyncState) {
  return projectInbox(
    { words: [], quotes: inbox.quotes },
    DEFAULT_SETTINGS,
    DEFAULT_AI_SETTINGS,
    ctx,
    persisted,
  );
}

describe('quote tags OR-Set projection', () => {
  it('projects local tags into the add-stamp map with empty tombstones', () => {
    const state = project({ quotes: [quoteFixture({ tags: ['a', 'b'] })] });
    expect(Object.keys(state.quotes.q1.tags ?? {}).sort()).toEqual(['a', 'b']);
    expect(state.quotes.q1.tagTombstones).toEqual({});
  });

  it('round-trips tags through materialize, sorted', () => {
    const state = project({ quotes: [quoteFixture({ tags: ['b', 'a'] })] });
    expect(materialize(state).inbox.quotes[0].tags).toEqual(['a', 'b']);
  });

  it('carries forward an existing tag add stamp (unrelated edit does not move it)', () => {
    const first = project({ quotes: [quoteFixture({ tags: ['a'], updatedAt: 20 })] });
    const addStampBefore = first.quotes.q1.tags!.a;
    // Unrelated edit bumps updatedAt; persisted state seeded as `prev`.
    const second = project(
      { quotes: [quoteFixture({ tags: ['a'], updatedAt: 999 })] },
      first,
    );
    expect(second.quotes.q1.tags!.a).toEqual(addStampBefore);
  });

  it('mints a re-add stamp strictly above a prior tombstone (closes same-ms race)', () => {
    const prev: SyncState = {
      ...project({ quotes: [quoteFixture({ tags: [] })] }),
    };
    prev.quotes.q1.tags = {};
    prev.quotes.q1.tagTombstones = { a: { wallTime: 5000, counter: 0, replicaId: 'A' } };
    // Re-add at the same wallTime as the tombstone.
    const state = project(
      { quotes: [quoteFixture({ tags: ['a'], updatedAt: 5000 })] },
      prev,
    );
    expect(state.quotes.q1.tags!.a.wallTime).toBe(5001);
  });

  it('liftLegacyTags folds a legacy fields.tags register into the OR-Set', () => {
    const node = {
      id: 'q1',
      fields: { tags: { value: ['legacy'], stamp: { wallTime: 7, counter: 0, replicaId: 'A' } } },
      createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } },
      reviewEvents: {},
    } as never;
    const lifted = liftLegacyTags(node);
    expect(Object.keys(lifted.tags ?? {})).toEqual(['legacy']);
    expect(lifted.tags!.legacy.wallTime).toBe(7);
  });

  it('materialize reads a node with no tags/tagTombstones without throwing', () => {
    const state = project({ quotes: [quoteFixture({ tags: ['a'] })] });
    delete state.quotes.q1.tags;
    delete state.quotes.q1.tagTombstones;
    expect(() => materialize(state)).not.toThrow();
    expect(materialize(state).inbox.quotes[0].tags).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/sync/project.test.ts -t "OR-Set projection"`
Expected: FAIL — `liftLegacyTags` not exported / `tags` map undefined / `projectInbox` signature mismatch.

- [ ] **Step 4: Implement `projectQuote`, `projectInbox`, `materialize`, `liftLegacyTags`**

In `lib/sync/project.ts`:

First, import the tag helper and `SyncState` is already imported. Add `normalizeTags` import at the top:

```ts
import { normalizeTags } from '../tags';
```

Replace `projectQuote` (lines 161-185) with the carry-forward version:

```ts
function projectQuote(quote: QuoteEntry, ctx: BootstrapContext, prev?: QuoteNode): QuoteNode {
  const s = stamp(quote.updatedAt, ctx.replicaId);
  const { reviewEvents, snapshot } = projectScheduler(`quote:${quote.id}`, quote.review, ctx.replicaId);

  // OR-Set add stamps with carry-forward: an already-present tag keeps its
  // persisted add stamp (so unrelated edits never move it past a tombstone);
  // a new tag or a re-add mints a fresh stamp guaranteed above any prior
  // tombstone (which also closes the same-millisecond re-add race).
  const tags: Record<string, HybridTimestamp> = {};
  for (const tag of normalizeTags(quote.tags)) {
    const prevAdd = prev?.tags?.[tag];
    const prevTomb = prev?.tagTombstones?.[tag];
    const stillPresent = prevAdd && !isSuppressed(prevAdd, prevTomb);
    tags[tag] = stillPresent
      ? prevAdd
      : stamp(Math.max(quote.updatedAt, (prevTomb?.wallTime ?? 0) + 1), ctx.replicaId);
  }

  return {
    id: quote.id,
    createdAt: reg(quote.createdAt, stamp(quote.createdAt, ctx.replicaId)),
    fields: {
      text: reg(quote.text, s),
      note: reg(quote.note, s),
      status: reg(quote.status, s),
      category: reg(quote.category, s),
      sourceTitle: reg(quote.sourceTitle, s),
      sourceUrl: reg(quote.sourceUrl, s),
      sourceDomain: reg(quote.sourceDomain, s),
      surrounding: reg(quote.surrounding, s),
      pinyin: reg(quote.pinyin ?? null, s),
      traditionalText: reg(quote.traditionalText ?? null, s),
      updatedAt: reg(quote.updatedAt, s),
    },
    tags,
    tagTombstones: {},
    reviewEvents,
    snapshot,
  };
}
```

(Note: `fields.tags` is removed; `category` register stays until Task 5.)

Change `projectInbox` (line 191) to accept and thread `persisted`:

```ts
export function projectInbox(
  inbox: Inbox,
  settings: AppSettings,
  ai: AiSettings,
  ctx: BootstrapContext,
  persisted?: SyncState,
): SyncState {
```

…and the quote loop (line 220):

```ts
  for (const quote of inbox.quotes) {
    state.quotes[quote.id] = projectQuote(quote, ctx, persisted?.quotes[quote.id]);
  }
```

Add `liftLegacyTags` near the other internal helpers (e.g. above `materialize`):

```ts
/**
 * Tolerant cross-version read: if a node has no OR-Set `tags` map (authored by
 * an older client) but carries a legacy `fields.tags` register, fold that
 * register's value into the OR-Set, each tag stamped with the register's stamp.
 * Safe to call on already-migrated nodes — it no-ops when `tags` is non-empty.
 * The empty-trigger is safe: a removed tag leaves a suppressed-but-present
 * entry, so a touched node's map is never empty; an empty map alongside a
 * legacy register only occurs for genuinely-old nodes.
 */
export function liftLegacyTags(node: QuoteNode): QuoteNode {
  const hasOrSet = node.tags && Object.keys(node.tags).length > 0;
  if (hasOrSet) return node;
  const legacy = node.fields.tags as Register<unknown> | undefined;
  const legacyValue = legacy?.value;
  if (!Array.isArray(legacyValue) || legacyValue.length === 0) return node;
  const tags: Record<string, HybridTimestamp> = {};
  for (const tag of normalizeTags(legacyValue as string[])) {
    tags[tag] = legacy!.stamp;
  }
  return { ...node, tags };
}
```

In `materialize`, replace the quote loop body's tag read. The current loop (lines 282-304) builds each quote; lift first and read the OR-Set:

```ts
  const quotes: QuoteEntry[] = [];
  for (const [id, raw] of Object.entries(state.quotes)) {
    if (isSuppressed(raw.fields.updatedAt?.stamp, state.tombstones[`quote:${id}`])) continue;
    const node = liftLegacyTags(raw);
    const review = rebuildReview(node);
    const tags = Object.entries(node.tags ?? {})
      .filter(([tag, stamp]) => !isSuppressed(stamp, node.tagTombstones?.[tag]))
      .map(([tag]) => tag)
      .sort();
    quotes.push({
      id: node.id,
      kind: 'quote',
      text: node.fields.text?.value as string,
      note: (node.fields.note?.value as string) ?? '',
      status: node.fields.status?.value as QuoteEntry['status'],
      category: (node.fields.category?.value as string) ?? 'uncategorized',
      tags,
      createdAt: node.createdAt.value,
      updatedAt: node.fields.updatedAt?.value as number,
      sourceTitle: (node.fields.sourceTitle?.value as string) ?? '',
      sourceUrl: (node.fields.sourceUrl?.value as string) ?? '',
      sourceDomain: (node.fields.sourceDomain?.value as string) ?? '',
      surrounding: (node.fields.surrounding?.value as string) ?? '',
      pinyin: (node.fields.pinyin?.value as string | null) ?? undefined,
      traditionalText: (node.fields.traditionalText?.value as string | null) ?? undefined,
      ...(review ? { review } : {}),
    });
  }
```

- [ ] **Step 5: Implement `mergeQuoteNodes`**

In `lib/sync/merge.ts`, replace `mergeQuoteNodes` (lines 97-106):

```ts
export function mergeQuoteNodes(a: QuoteNode, b: QuoteNode): QuoteNode {
  const la = liftLegacyTags(a);
  const lb = liftLegacyTags(b);
  const events = mergeReviewEvents(la.reviewEvents, lb.reviewEvents);
  return {
    id: la.id,
    createdAt: earliestCreatedAt(la.createdAt, lb.createdAt),
    fields: mergeRegisterMap(la.fields, lb.fields),
    tags: mergeStampMap(la.tags ?? {}, lb.tags ?? {}),
    tagTombstones: mergeStampMap(la.tagTombstones ?? {}, lb.tagTombstones ?? {}),
    reviewEvents: events,
    snapshot: pickSnapshot(events, la.snapshot, lb.snapshot),
  };
}
```

Add the import at the top of `lib/sync/merge.ts`:

```ts
import { liftLegacyTags } from './project';
```

- [ ] **Step 6: Pass `persisted` into projection from the coordinator**

In `lib/sync/coordinator.ts`, the persisted state is already read at the top of
the pass:

```ts
  const metaSnapshot = await syncMetadataStorage.getValue();
  const persisted = metaSnapshot.state;
```

Append `persisted` as the 5th argument to the existing `projectInbox` call.
**Keep the `ctx` fields already present** (`settingsStamp` / `aiStamp`, added by
the settings-versioning work) — only add the new parameter:

```ts
  let merged: SyncState = projectInbox(
    inbox,
    settings,
    ai,
    {
      replicaId: deps.replicaId,
      wallTime: deps.now(),
      settingsStamp: metaSnapshot.appSettingsUpdatedAt,
      aiStamp: metaSnapshot.aiSettingsUpdatedAt,
    },
    persisted ?? undefined,
  );
```

Per the durable-state prerequisite above, `persisted` is reliably non-null on
every pass after bootstrap, so carry-forward actually engages.

(`reconcileOnStartup` in `lib/sync/mutations.ts` keeps calling `projectInbox`
without the 5th arg, so `persisted` defaults to `undefined`. That path already
merges any existing tombstones back in itself — the `7a5afcc` hardening — so the
add stamps it mints fresh from `updatedAt` cannot resurrect a tombstoned tag.)

- [ ] **Step 7: Write the failing OR-Set merge tests**

Add to `tests/sync/merge.test.ts` (import `mergeQuoteNodes` if not already, plus a small node fixture):

```ts
import { mergeQuoteNodes } from '../../lib/sync/merge';
import type { QuoteNode } from '../../lib/sync/types';

function qnode(over: Partial<QuoteNode> = {}): QuoteNode {
  return {
    id: 'q1',
    fields: { updatedAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } } },
    createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } },
    tags: {},
    tagTombstones: {},
    reviewEvents: {},
    ...over,
  };
}
const ts = (w: number, r = 'A') => ({ wallTime: w, counter: 0, replicaId: r });

describe('mergeQuoteNodes tag OR-Set', () => {
  it('unions concurrent adds of different tags', () => {
    const a = qnode({ tags: { a: ts(10) } });
    const b = qnode({ tags: { b: ts(11, 'B') } });
    const m = mergeQuoteNodes(a, b);
    expect(Object.keys(m.tags!).sort()).toEqual(['a', 'b']);
  });

  it('a remove suppresses a stale add it causally saw', () => {
    const a = qnode({ tags: { a: ts(10) }, tagTombstones: { a: ts(20) } });
    const b = qnode({ tags: { a: ts(10) } });
    const m = mergeQuoteNodes(a, b);
    // add stamp 10 <= tombstone 20 => suppressed
    expect(m.tagTombstones!.a.wallTime).toBe(20);
    expect(m.tags!.a.wallTime).toBe(10);
  });

  it('keeps the max add stamp and max tombstone per tag', () => {
    const a = qnode({ tags: { a: ts(10) }, tagTombstones: { a: ts(15) } });
    const b = qnode({ tags: { a: ts(30, 'B') }, tagTombstones: {} });
    const m = mergeQuoteNodes(a, b);
    expect(m.tags!.a.wallTime).toBe(30);
    expect(m.tagTombstones!.a.wallTime).toBe(15);
  });
});
```

- [ ] **Step 8: Run all sync tests**

Run: `npx vitest run tests/sync/project.test.ts tests/sync/merge.test.ts`
Expected: PASS (including the pre-existing tests, which still see `tags` materialized — now via the OR-Set).

- [ ] **Step 9: Add the resurrection regression test**

This is the must-fix from the spec. Add to `tests/sync/merge.test.ts`:

```ts
import { mergeSyncState } from '../../lib/sync/merge';
import { projectInbox, materialize } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { QuoteEntry, Inbox } from '../../lib/types';

function quoteInbox(tags: string[], updatedAt: number): Inbox {
  return {
    words: [],
    quotes: [{
      id: 'q1', kind: 'quote', text: 'hi', note: '', status: 'inbox',
      category: 'uncategorized', tags, createdAt: 10, updatedAt,
      sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
    } as QuoteEntry],
  };
}

describe('tag resurrection regression', () => {
  it('a remove on A is not resurrected by an unrelated edit on B', () => {
    const ctxA = { replicaId: 'A', wallTime: 100 };
    const ctxB = { replicaId: 'B', wallTime: 100 };

    // Both start with tag "foo" at updatedAt 20.
    let a = projectInbox(quoteInbox(['foo'], 20), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxA);

    // A removes foo: record tombstone at wallTime 50, project the now-empty tag set.
    a.quotes.q1.tagTombstones = { foo: { wallTime: 50, counter: 0, replicaId: 'A' } };
    a = mergeSyncState(
      a,
      projectInbox(quoteInbox([], 50), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxA, a),
    );
    expect(materialize(a).inbox.quotes[0].tags).toEqual([]); // suppressed on A

    // B still holds foo and edits its note (updatedAt 80) WITHOUT seeing the tombstone.
    const bPrev = projectInbox(quoteInbox(['foo'], 20), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxB);
    const b = mergeSyncState(
      bPrev,
      projectInbox(quoteInbox(['foo'], 80), DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctxB, bPrev),
    );
    // Carry-forward keeps foo's add stamp at 20, NOT 80.
    expect(b.quotes.q1.tags!.foo.wallTime).toBe(20);

    // A merges B's replica: foo must stay removed.
    const merged = mergeSyncState(a, b);
    expect(materialize(merged).inbox.quotes[0].tags).toEqual([]);
  });
});
```

- [ ] **Step 10: Run the regression test**

Run: `npx vitest run tests/sync/merge.test.ts -t "resurrection"`
Expected: PASS.

- [ ] **Step 11: Typecheck and commit**

```bash
npm run compile
git add lib/sync/types.ts lib/sync/project.ts lib/sync/merge.ts lib/sync/coordinator.ts tests/sync/project.test.ts tests/sync/merge.test.ts
git commit -m "feat(sync): tags as add-wins OR-Set with carry-forward add stamps + legacy lift"
```

---

## Task 4: `removeTags` sync mutation (batched, explicit tombstones)

**Files:**
- Modify: `lib/sync/mutations.ts` (add `applyTagRemoval`)
- Modify: `entrypoints/background/sync-mutation-handler.ts` (kind + route)
- Test: `tests/sync/sync-mutation-handler.test.ts`

**Interfaces:**
- Consumes: `ensureReplicaId`, `syncMetadataStorage`, `mutateSyncConfig`, `EMPTY_SYNC_STATE`, the single-writer `chain`.
- Produces:
  - `applyTagRemoval(removals: Array<{ quoteId: string; tags: string[] }>): Promise<void>`
  - `SyncMutationRequestMessage['kind']` gains `'removeTags'`; `removeTags` payload shape `{ removals: Array<{ quoteId: string; tags: string[] }> }`.

- [ ] **Step 1: Write the failing handler test**

Add to `tests/sync/sync-mutation-handler.test.ts` (follow the file's existing setup for resetting fake storage; mirror the `applyDeletion` test that's already there):

```ts
import { applyTagRemoval } from '../../lib/sync/mutations';

describe('applyTagRemoval', () => {
  it('records tombstones for a batched multi-quote payload and bumps revision once', async () => {
    // Seed persisted state with two quotes that have tags (mirror existing seeding helper).
    await syncMetadataStorage.setValue({
      revision: 5,
      lastDigest: null,
      // appSettingsUpdatedAt / aiSettingsUpdatedAt are required SyncMetadata
      // fields (added in commit 762efa1); seed them as 0 ("unversioned").
      appSettingsUpdatedAt: 0,
      aiSettingsUpdatedAt: 0,
      state: {
        ...EMPTY_SYNC_STATE,
        quotes: {
          q1: { id: 'q1', fields: {}, createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } }, tags: { a: { wallTime: 1, counter: 0, replicaId: 'A' }, b: { wallTime: 1, counter: 0, replicaId: 'A' } }, tagTombstones: {}, reviewEvents: {} },
          q2: { id: 'q2', fields: {}, createdAt: { value: 1, stamp: { wallTime: 1, counter: 0, replicaId: 'A' } }, tags: { a: { wallTime: 1, counter: 0, replicaId: 'A' } }, tagTombstones: {}, reviewEvents: {} },
        },
      },
    });

    await applyTagRemoval([
      { quoteId: 'q1', tags: ['a'] },
      { quoteId: 'q2', tags: ['a'] },
    ]);

    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(6); // bumped exactly once
    expect(meta.state!.quotes.q1.tagTombstones!.a).toBeDefined();
    expect(meta.state!.quotes.q2.tagTombstones!.a).toBeDefined();
    expect(meta.state!.quotes.q1.tagTombstones!.b).toBeUndefined();
  });

  it('creates the quote node and tagTombstones map if missing', async () => {
    await syncMetadataStorage.setValue({ revision: 0, lastDigest: null, appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0, state: { ...EMPTY_SYNC_STATE } });
    await applyTagRemoval([{ quoteId: 'new', tags: ['x'] }]);
    const meta = await syncMetadataStorage.getValue();
    expect(meta.state!.quotes.new.tagTombstones!.x).toBeDefined();
  });
});
```

(Import `EMPTY_SYNC_STATE` and `syncMetadataStorage` at the top if not already.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/sync/sync-mutation-handler.test.ts -t "applyTagRemoval"`
Expected: FAIL — `applyTagRemoval` not exported.

- [ ] **Step 3: Implement `applyTagRemoval`**

In `lib/sync/mutations.ts`, add after `applyDeletion` (around line 73):

```ts
export async function applyTagRemoval(
  removals: Array<{ quoteId: string; tags: string[] }>,
): Promise<void> {
  const run = chain.then(async () => {
    const replicaId = await ensureReplicaId();
    const meta = await syncMetadataStorage.getValue();
    const state: SyncState = meta.state ?? (JSON.parse(JSON.stringify(EMPTY_SYNC_STATE)) as SyncState);
    const now = Date.now();
    for (const { quoteId, tags } of removals) {
      let node = state.quotes[quoteId];
      if (!node) {
        node = {
          id: quoteId,
          fields: {},
          createdAt: { value: now, stamp: { wallTime: now, counter: 0, replicaId } },
          tags: {},
          tagTombstones: {},
          reviewEvents: {},
        };
        state.quotes[quoteId] = node;
      }
      if (!node.tagTombstones) node.tagTombstones = {};
      for (const tag of tags) {
        node.tagTombstones[tag] = { wallTime: now, counter: 0, replicaId };
      }
    }
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({
      revision: nextRevision,
      state,
      lastDigest: meta.lastDigest,
      // Carry the settings/AI version stamps forward (required SyncMetadata
      // fields since commit 762efa1) — mirror applyDeletion.
      appSettingsUpdatedAt: meta.appSettingsUpdatedAt,
      aiSettingsUpdatedAt: meta.aiSettingsUpdatedAt,
    });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: true,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}
```

- [ ] **Step 4: Wire the `removeTags` kind in the handler**

In `entrypoints/background/sync-mutation-handler.ts`:

Import `applyTagRemoval`:

```ts
import { applyDeletion, applyLocalMutation, applyTagRemoval } from '../../lib/sync/mutations';
```

Extend the kind union (line 12):

```ts
  kind: 'inbox' | 'settings' | 'ai' | 'delete' | 'removeTags';
```

Add the route in `writeKind` (after the `delete` branch, line 17-20):

```ts
  if (kind === 'removeTags') {
    const { removals } = payload as { removals: Array<{ quoteId: string; tags: string[] }> };
    await applyTagRemoval(removals);
    return;
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/sync/sync-mutation-handler.test.ts`
Expected: PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
npm run compile
git add lib/sync/mutations.ts entrypoints/background/sync-mutation-handler.ts tests/sync/sync-mutation-handler.test.ts
git commit -m "feat(sync): batched removeTags mutation records per-tag tombstones"
```

---

## Task 5: Remove the `category` field end-to-end

**Files:**
- Modify: `lib/types.ts:82-91`
- Modify: `lib/capture.ts:78-94`
- Modify: `lib/sync/project.ts` (`projectQuote` drop category register; `materialize` drop category output)
- Modify: `lib/backup.ts:120-133` (`isQuoteEntry`) and `lib/backup.ts:315-323` (`cloneInbox`)
- Modify: `lib/markdown.ts:85-92`
- Modify: `entrypoints/dashboard/App.tsx:372-386` (`entryMatchesQuery`)
- Modify: `entrypoints/dashboard/components/QuoteCard.tsx:49-54`
- Modify: `entrypoints/dashboard/components/ReviewQueue.tsx:244-248`
- Modify: `lib/i18n.ts` (`toolbar.searchPlaceholder` copy)
- Test: `tests/capture.test.ts`, `tests/backup.test.ts`, `tests/markdown.test.ts`, `tests/review-queue.test.tsx`

**Interfaces:**
- Consumes: `migrateQuoteCategoryToTags` from `lib/tags`.
- Produces: `QuoteEntry` without `category`. All consumers updated.

> This is the single atomic "collapse category into tags" change — it must compile as one commit because removing the type field breaks every reader simultaneously.

- [ ] **Step 1: Update the failing tests first**

In `tests/capture.test.ts`, find the quote-capture assertion and change it to assert no category and empty tags. Add/replace:

```ts
it('captured quotes have no category field and start with empty tags', async () => {
  const quote = await saveQuote('你好世界', {
    sourceTitle: 't', sourceUrl: 'u', sourceDomain: 'd', surrounding: 's', capturedAt: 1,
  });
  expect(quote).not.toBeNull();
  expect('category' in (quote as object)).toBe(false);
  expect(quote!.tags).toEqual([]);
});
```

In `tests/backup.test.ts`, add a restore-migration test:

```ts
it('restoring an old backup folds category into tags and drops category', () => {
  const raw = JSON.stringify({
    app: 'shiyu-hanzi-box', formatVersion: 2, exportedAt: '2026-01-01T00:00:00.000Z',
    words: [],
    quotes: [{
      id: 'q1', kind: 'quote', text: 't', note: '', status: 'inbox',
      category: 'Poetry', tags: ['a'], createdAt: 1, updatedAt: 1,
      sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
    }],
  });
  const inbox = parseBackup(raw);
  expect(inbox.quotes[0].tags).toEqual(['a', 'poetry']);
  expect('category' in inbox.quotes[0]).toBe(false);
});
```

In `tests/markdown.test.ts`, update the quote-rendering expectation to assert the `_category:_` segment is gone and `#tag` rendering remains:

```ts
it('renders quote tags as #hashtags without a category line', () => {
  const md = renderDay('2026-01-01', [], [{
    id: 'q1', kind: 'quote', text: 'hi', note: '', status: 'inbox',
    tags: ['poetry', 'news'], createdAt: 1, updatedAt: 1,
    sourceTitle: 'Src', sourceUrl: 'http://x', sourceDomain: 'x', surrounding: '',
  } as never]);
  expect(md).not.toContain('_category:_');
  expect(md).toContain('#poetry #news');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/capture.test.ts tests/backup.test.ts tests/markdown.test.ts`
Expected: FAIL (and/or type errors once the field is removed in Step 3).

- [ ] **Step 3: Remove `category` from the type**

In `lib/types.ts`, replace the `QuoteEntry` interface (lines 82-91):

```ts
export interface QuoteEntry extends EntryBase {
  kind: 'quote';
  tags: string[];
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  clozes?: Cloze[];    // absent or [] => parked (not review-eligible)
}
```

- [ ] **Step 4: Update `capture.ts`**

In `lib/capture.ts`, remove the `category: 'uncategorized',` line (line 82) from the new-quote object.

- [ ] **Step 5: Drop the category register from sync**

In `lib/sync/project.ts` `projectQuote`, delete the line:

```ts
      category: reg(quote.category, s),
```

In `materialize`'s quote push (from Task 3), delete the line:

```ts
      category: (node.fields.category?.value as string) ?? 'uncategorized',
```

- [ ] **Step 6: Update backup validation + clone migration**

In `lib/backup.ts` `isQuoteEntry` (lines 120-133), remove `isString(value.category) &&`.

In `cloneInbox` (lines 315-323), apply the migration to each quote. Add the import at the top of `lib/backup.ts`:

```ts
import { migrateQuoteCategoryToTags } from './tags';
```

…and change the quotes mapping:

```ts
    quotes: cloneJson(inbox.quotes).map((quote) =>
      sanitizeQuoteClozes(migrateQuoteCategoryToTags(quote) as QuoteEntry),
    ),
```

- [ ] **Step 7: Update `markdown.ts`**

In `lib/markdown.ts`, replace the quote loop body (lines 85-91):

```ts
    for (const quote of quotes) {
      const tags = quote.tags.length > 0 ? `  - ${quote.tags.map((tag) => `#${tag}`).join(' ')}` : null;
      lines.push(`- [ ] > ${renderQuoteBody(quote)}`);
      if (tags) lines.push(tags);
      if (quote.note) lines.push(`  - ${esc(quote.note)}`);
      lines.push(`  - [${esc(quote.sourceTitle || quote.sourceDomain)}](${quote.sourceUrl})`);
      lines.push('');
    }
```

- [ ] **Step 8: Update search in `App.tsx`**

In `entrypoints/dashboard/App.tsx` `entryMatchesQuery` (lines 376-381), drop `category` from the quote source string:

```ts
  const source =
    entry.kind === 'quote'
      ? `${entry.sourceTitle} ${entry.sourceDomain}`
      : entry.occurrences
          .map((occurrence) => `${occurrence.sourceTitle} ${occurrence.sourceDomain}`)
          .join(' ');
```

- [ ] **Step 9: Remove the category input from `QuoteCard`**

In `entrypoints/dashboard/components/QuoteCard.tsx`, delete the `<input>` block (lines 50-54). (The tag-chip editor is added in Task 7; for now the row just keeps the source link + traditional button.)

- [ ] **Step 10: Replace the category badge in `ReviewQueue`**

In `entrypoints/dashboard/components/ReviewQueue.tsx`, replace the category badge (lines 244-248):

```tsx
          {entry.kind === 'quote' && entry.tags.length > 0 && (
            <span className="flex flex-wrap gap-1">
              {entry.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-cinnabar"
                >
                  #{tag}
                </span>
              ))}
            </span>
          )}
```

- [ ] **Step 11: Update the search placeholder copy**

In `lib/i18n.ts`, change `toolbar.searchPlaceholder` in **both** locale blocks:
- `en` (line 20): `'Search words, quotes, tags...'`
- `zh-CN` (the matching key): `'搜索字词、句子、标签…'`

- [ ] **Step 12: Run the full test suite + typecheck**

Run: `npm run compile && npx vitest run`
Expected: PASS. Investigate any remaining `category` references the compiler flags and remove them (search: `grep -rn "category" lib entrypoints tests`).

- [ ] **Step 13: Commit**

```bash
git add lib/types.ts lib/capture.ts lib/sync/project.ts lib/backup.ts lib/markdown.ts lib/i18n.ts entrypoints/dashboard/App.tsx entrypoints/dashboard/components/QuoteCard.tsx entrypoints/dashboard/components/ReviewQueue.tsx tests/
git commit -m "feat(quotes): remove category field, collapse into tags everywhere"
```

---

## Task 6: Dashboard write path — `setQuoteTags` + tag management

**Files:**
- Modify: `entrypoints/dashboard/App.tsx` (add `setQuoteTags`, `renameTagEverywhere`, `deleteTagEverywhere`; plumb to `QuoteList`)
- Modify: `entrypoints/dashboard/components/QuoteList.tsx` (accept new props; pass `onSetTags` to cards)
- Test: covered by `tests/tags.test.ts` `planTagWrite` (Task 1) for the pure logic; wiring verified by Task 7's component test.

**Interfaces:**
- Consumes: `planTagWrite`, `addTag`, `removeTag` from `lib/tags`; `requestSyncMutation`.
- Produces (in `App.tsx`):
  - `setQuoteTags(id: string, nextTags: string[]): void`
  - `renameTagEverywhere(from: string, to: string): void`
  - `deleteTagEverywhere(tag: string): void`
- Produces (prop contract): `QuoteList` gains `onSetTags: (id: string, nextTags: string[]) => void`.

- [ ] **Step 1: Implement `setQuoteTags` and management helpers in `App.tsx`**

Add the import (near line 38):

```ts
import { addTag, planTagWrite, removeTag, normalizeTag } from '@/lib/tags';
```

Add these functions next to `updateQuote` (after line 170):

```ts
  function setQuoteTags(id: string, nextTags: string[]) {
    const current = inbox.quotes.find((q) => q.id === id);
    if (!current) return;
    const { next, removed } = planTagWrite(current.tags, nextTags);
    if (removed.length > 0) {
      void requestSyncMutation('removeTags', { removals: [{ quoteId: id, tags: removed }] });
    }
    void mutate((draft) => ({
      ...draft,
      quotes: draft.quotes.map((quote) =>
        quote.id === id ? { ...quote, tags: next, updatedAt: Date.now() } : quote,
      ),
    }));
  }

  function renameTagEverywhere(from: string, to: string) {
    const fromTag = normalizeTag(from);
    const toTag = normalizeTag(to);
    if (fromTag === '' || toTag === '' || fromTag === toTag) return;
    const removals: Array<{ quoteId: string; tags: string[] }> = [];
    void mutate((draft) => ({
      ...draft,
      quotes: draft.quotes.map((quote) => {
        if (!quote.tags.includes(fromTag)) return quote;
        removals.push({ quoteId: quote.id, tags: [fromTag] });
        return { ...quote, tags: addTag(removeTag(quote.tags, fromTag), toTag), updatedAt: Date.now() };
      }),
    }));
    if (removals.length > 0) void requestSyncMutation('removeTags', { removals });
  }

  function deleteTagEverywhere(tag: string) {
    const target = normalizeTag(tag);
    if (target === '') return;
    const removals: Array<{ quoteId: string; tags: string[] }> = [];
    void mutate((draft) => ({
      ...draft,
      quotes: draft.quotes.map((quote) => {
        if (!quote.tags.includes(target)) return quote;
        removals.push({ quoteId: quote.id, tags: [target] });
        return { ...quote, tags: removeTag(quote.tags, target), updatedAt: Date.now() };
      }),
    }));
    if (removals.length > 0) void requestSyncMutation('removeTags', { removals });
  }
```

(The `mutate` callback in `useInbox` is `(fn) => ...` reading the freshest stored inbox, so capturing `removals` inside the mapper is correct — the loop runs once over the persisted snapshot.)

- [ ] **Step 2: Add `onSetTags` to the `QuoteList` prop type and thread it**

In `entrypoints/dashboard/components/QuoteList.tsx`, extend the props (lines 7-17):

```ts
export function QuoteList({
  quotes,
  onUpdate,
  onDelete,
  onSetTags,
  locale,
}: {
  quotes: QuoteEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
  onSetTags: (id: string, nextTags: string[]) => void;
  locale: UiLocale;
}) {
```

Pass it to each `QuoteCard` (line 65-72):

```tsx
            <QuoteCard
              key={quote.id}
              quote={quote}
              onUpdate={(patch) => onUpdate(quote.id, patch)}
              onSetTags={(nextTags) => onSetTags(quote.id, nextTags)}
              onDelete={() => onDelete(quote.id)}
              locale={locale}
              showParkedMarker={isParkedQuote(quote)}
            />
```

- [ ] **Step 3: Pass `onSetTags` from `App.tsx`**

In `entrypoints/dashboard/App.tsx`, update the `<QuoteList>` render (lines 336-341):

```tsx
            <QuoteList
              quotes={matches.quotes}
              onUpdate={updateQuote}
              onDelete={deleteQuote}
              onSetTags={setQuoteTags}
              locale={locale}
            />
```

- [ ] **Step 4: Add the `onSetTags` prop to `QuoteCard`'s type (placeholder body)**

In `entrypoints/dashboard/components/QuoteCard.tsx`, add `onSetTags` to the props type so the build passes; the editor UI lands in Task 7:

```ts
export function QuoteCard({
  quote,
  onUpdate,
  onSetTags,
  onDelete,
  locale,
  showParkedMarker = false,
}: {
  quote: QuoteEntry;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  onSetTags: (nextTags: string[]) => void;
  onDelete: () => void;
  locale: UiLocale;
  showParkedMarker?: boolean;
}) {
```

- [ ] **Step 5: Typecheck**

Run: `npm run compile`
Expected: No errors. (`onSetTags` is accepted but not yet used in `QuoteCard` — that's fine; if the lint config errors on unused props, reference it with a `void onSetTags;` line removed in Task 7, otherwise leave it.)

- [ ] **Step 6: Run existing quote-list test**

Run: `npx vitest run tests/quote-list.test.tsx`
Expected: PASS (update the test's `QuoteList` render to pass an `onSetTags={() => {}}` prop if it instantiates the component directly).

- [ ] **Step 7: Commit**

```bash
git add entrypoints/dashboard/App.tsx entrypoints/dashboard/components/QuoteList.tsx entrypoints/dashboard/components/QuoteCard.tsx tests/quote-list.test.tsx
git commit -m "feat(quotes): setQuoteTags write path + rename/delete-everywhere helpers"
```

---

## Task 7: QuoteCard tag-chip editor + autocomplete

**Files:**
- Modify: `entrypoints/dashboard/components/QuoteCard.tsx`
- Modify: `entrypoints/dashboard/components/QuoteList.tsx` (pass `knownTags` down)
- Modify: `entrypoints/dashboard/App.tsx` (compute and pass `knownTags`)
- Modify: `lib/i18n.ts` (tag-editor strings)
- Test: `tests/quote-list.test.tsx` (extend)

**Interfaces:**
- Consumes: `onSetTags` (Task 6), `tagCounts`/`addTag`/`removeTag` from `lib/tags`.
- Produces (prop contract): `QuoteCard` and `QuoteList` gain `knownTags: string[]`.

- [ ] **Step 1: Write the failing component test**

Add to `tests/quote-list.test.tsx` (using the file's existing render setup; `@testing-library/react`):

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { QuoteCard } from '../entrypoints/dashboard/components/QuoteCard';

function quote(over = {}) {
  return {
    id: 'q1', kind: 'quote', text: 'hi', note: '', status: 'inbox',
    tags: ['poetry'], createdAt: 1, updatedAt: 1,
    sourceTitle: '', sourceUrl: '', sourceDomain: '', surrounding: '',
    ...over,
  } as never;
}

describe('QuoteCard tag editor', () => {
  it('renders existing tags as chips and has no category input', () => {
    render(<QuoteCard quote={quote()} onUpdate={() => {}} onSetTags={() => {}} onDelete={() => {}} knownTags={['poetry', 'news']} locale="en" />);
    expect(screen.getByText('poetry')).toBeTruthy();
    // No freeform category input remains.
    expect(screen.queryByDisplayValue('uncategorized')).toBeNull();
  });

  it('commits a new tag on Enter via onSetTags', () => {
    const calls: string[][] = [];
    render(<QuoteCard quote={quote()} onUpdate={() => {}} onSetTags={(t) => calls.push(t)} onDelete={() => {}} knownTags={[]} locale="en" />);
    const input = screen.getByPlaceholderText('Add tag') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'News' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(calls[0]).toEqual(['poetry', 'News']);
  });

  it('removes a tag when its × is clicked', () => {
    const calls: string[][] = [];
    render(<QuoteCard quote={quote({ tags: ['poetry', 'news'] })} onUpdate={() => {}} onSetTags={(t) => calls.push(t)} onDelete={() => {}} knownTags={[]} locale="en" />);
    fireEvent.click(screen.getByLabelText('Remove tag poetry'));
    expect(calls[0]).toEqual(['news']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/quote-list.test.tsx -t "tag editor"`
Expected: FAIL — `knownTags` prop / `Add tag` input / chips not present.

- [ ] **Step 3: Add the i18n strings**

In `lib/i18n.ts`, add to **both** locale blocks (near the other `quote.*` keys):
- `en`: `'quote.addTag': 'Add tag',` and `'quote.removeTag': 'Remove tag {tag}',`
- `zh-CN`: `'quote.addTag': '添加标签',` and `'quote.removeTag': '移除标签 {tag}',`

- [ ] **Step 4: Implement the tag-chip editor in `QuoteCard`**

In `entrypoints/dashboard/components/QuoteCard.tsx`:

Add the `knownTags` prop to the type:

```ts
  knownTags,
```
```ts
  knownTags: string[];
```

Add imports and local state:

```ts
import { formatMessage, t } from '@/lib/i18n';
import { addTag, removeTag } from '@/lib/tags';
```
```ts
  const [tagInput, setTagInput] = useState('');
  const listId = `tags-${quote.id}`;
  const suggestions = knownTags
    .filter((tag) => !quote.tags.includes(tag) && tag.includes(tagInput.trim().toLowerCase()))
    .slice(0, 8);

  function commitTag() {
    const raw = tagInput;
    setTagInput('');
    if (raw.trim() === '') return;
    onSetTags(addTag(quote.tags, raw));
  }
```

Replace the metadata row where the category input used to be (the `<div className="mt-3 flex flex-wrap ...">` block, lines ~49-73) so it renders chips + input + the source link + traditional button:

```tsx
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        {quote.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-cinnabar"
          >
            #{tag}
            <button
              type="button"
              aria-label={formatMessage(locale, 'quote.removeTag', { tag })}
              onClick={() => onSetTags(removeTag(quote.tags, tag))}
              className="text-cinnabar/70 transition hover:text-cinnabar"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={tagInput}
          list={listId}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commitTag();
            }
          }}
          onBlur={commitTag}
          placeholder={t(locale, 'quote.addTag')}
          className="w-24 rounded-sm border border-border bg-paper-input px-2 py-1 text-ink outline-none transition focus:border-cinnabar-fade"
        />
        <datalist id={listId}>
          {suggestions.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-border bg-paper-input px-2 py-1 hover:text-cinnabar"
          >
            {quote.sourceTitle || quote.sourceDomain}
          </a>
        )}
        <TraditionalButton
          text={quote.text}
          existing={quote.traditionalText}
          onGenerated={(traditionalText) => onUpdate({ traditionalText })}
          shown={showTraditional}
          onToggle={() => setShowTraditional((value) => !value)}
          locale={locale}
        />
      </div>
```

- [ ] **Step 5: Thread `knownTags` through `QuoteList` and `App`**

In `entrypoints/dashboard/components/QuoteList.tsx`, add `knownTags: string[]` to the props and pass `knownTags={knownTags}` to each `QuoteCard`.

In `entrypoints/dashboard/App.tsx`, compute the full vocabulary (autocomplete uses *all* quotes per spec) and pass it:

```ts
import { tagCounts } from '@/lib/tags';
```
```ts
  const knownTags = useMemo(
    () => [...tagCounts(inbox.quotes).keys()].sort(),
    [inbox.quotes],
  );
```
…and add `knownTags={knownTags}` to the `<QuoteList>` render.

- [ ] **Step 6: Run the component tests**

Run: `npx vitest run tests/quote-list.test.tsx`
Expected: PASS.

- [ ] **Step 7: Typecheck and commit**

```bash
npm run compile
git add entrypoints/dashboard/components/QuoteCard.tsx entrypoints/dashboard/components/QuoteList.tsx entrypoints/dashboard/App.tsx lib/i18n.ts tests/quote-list.test.tsx
git commit -m "feat(quotes): tag-chip editor with autocomplete on QuoteCard"
```

---

## Task 8: Tag filtering + List|Cloud sub-tabs

**Files:**
- Modify: `entrypoints/dashboard/App.tsx` (`selectedTags` state, filter composition, pass props)
- Modify: `entrypoints/dashboard/components/QuoteList.tsx` (sub-tabs, filter chips)
- Modify: `lib/i18n.ts` (sub-tab + filter strings)
- Test: new `tests/quote-filter.test.ts` (pure filter), `tests/quote-list.test.tsx` (sub-tab toggle)

**Interfaces:**
- Consumes: `selectedTags: Set<string>` from `App`.
- Produces:
  - `quoteMatchesTags(quote, selectedTags): boolean` (exported pure helper in `lib/tags.ts`).
  - `QuoteList` props: `selectedTags: Set<string>`, `onToggleTag: (tag: string) => void`, `cloudQuotes: QuoteEntry[]`, `view`/`onViewChange` (or internal `view` state), plus `onRenameTag`/`onDeleteTag` forwarded to `TagCloud` (Task 9).

- [ ] **Step 1: Add and test the pure filter helper**

Add to `lib/tags.ts`:

```ts
/** OR semantics: a quote matches if it has any selected tag (empty set = all). */
export function quoteMatchesTags(quote: QuoteEntry, selectedTags: Set<string>): boolean {
  if (selectedTags.size === 0) return true;
  return quote.tags.some((tag) => selectedTags.has(tag));
}
```

Create `tests/quote-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { quoteMatchesTags } from '../lib/tags';
import type { QuoteEntry } from '../lib/types';

const q = (tags: string[]) => ({ tags } as QuoteEntry);

describe('quoteMatchesTags (OR semantics)', () => {
  it('matches all when no tags selected', () => {
    expect(quoteMatchesTags(q(['a']), new Set())).toBe(true);
  });
  it('matches when any selected tag is present', () => {
    expect(quoteMatchesTags(q(['a', 'x']), new Set(['x', 'y']))).toBe(true);
  });
  it('does not match when no selected tag is present', () => {
    expect(quoteMatchesTags(q(['a']), new Set(['x']))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the filter test to verify it fails, then passes**

Run: `npx vitest run tests/quote-filter.test.ts`
Expected: FAIL (not exported) → after adding the helper, PASS.

- [ ] **Step 3: Add `selectedTags` to `App` and compose the filters**

In `entrypoints/dashboard/App.tsx`:

```ts
import { quoteMatchesTags, tagCounts } from '@/lib/tags';
```
```ts
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());

  function toggleTag(tag: string) {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  }
```

Split the quote matching so the Cloud can ignore the tag filter. Replace the `matches` memo's `quotes` (lines 95-98) — compute the query+status set, then apply tags:

```ts
  const matches = useMemo(() => {
    const byStatus = (status: Status) =>
      statusFilter === 'all' || status === statusFilter;
    const quotesByQueryStatus = inbox.quotes.filter(
      (quote) => entryMatchesQuery(quote, normalizedQuery) && byStatus(quote.status),
    );
    return {
      words: inbox.words.filter(
        (word) => entryMatchesQuery(word, normalizedQuery) && byStatus(word.status),
      ),
      quotesByQueryStatus,
      quotes: quotesByQueryStatus.filter((quote) => quoteMatchesTags(quote, selectedTags)),
    };
  }, [inbox, normalizedQuery, statusFilter, selectedTags]);
```

- [ ] **Step 4: Add sub-tab + filter i18n strings**

In `lib/i18n.ts`, add to **both** locale blocks:
- `en`: `'quote.viewList': 'List',` `'quote.viewCloud': 'Cloud',` `'quote.clearFilters': 'Clear tag filters',`
- `zh-CN`: `'quote.viewList': '列表',` `'quote.viewCloud': '标签云',` `'quote.clearFilters': '清除标签筛选',`

- [ ] **Step 5: Add sub-tabs + filter chips to `QuoteList`**

In `entrypoints/dashboard/components/QuoteList.tsx`, extend the props and render. Replace the component signature and add a `view` state + a header. Full updated props block:

```tsx
import { useState } from 'react';
import { countParkedQuotes, isParkedQuote } from '@/lib/cloze';
import { formatMessage, t } from '@/lib/i18n';
import type { QuoteEntry, UiLocale } from '@/lib/types';
import { QuoteCard } from './QuoteCard';
import { TagCloud } from './TagCloud';

export function QuoteList({
  quotes,
  cloudQuotes,
  onUpdate,
  onDelete,
  onSetTags,
  knownTags,
  selectedTags,
  onToggleTag,
  onRenameTag,
  onDeleteTag,
  locale,
}: {
  quotes: QuoteEntry[];
  cloudQuotes: QuoteEntry[];
  onUpdate: (id: string, patch: Partial<QuoteEntry>) => void;
  onDelete: (id: string) => void;
  onSetTags: (id: string, nextTags: string[]) => void;
  knownTags: string[];
  selectedTags: Set<string>;
  onToggleTag: (tag: string) => void;
  onRenameTag: (from: string, to: string) => void;
  onDeleteTag: (tag: string) => void;
  locale: UiLocale;
}) {
  const [view, setView] = useState<'list' | 'cloud'>('list');
  const [showParkedOnly, setShowParkedOnly] = useState(false);
```

Add a sub-tab switcher above the existing content (inside the returned root, before the parked filter bar). When `view === 'cloud'`, render `<TagCloud>`; otherwise the existing list. Insert at the top of the returned `<div className="space-y-3">`:

```tsx
      <div className="flex items-center gap-2">
        <button
          onClick={() => setView('list')}
          className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition ${view === 'list' ? 'border-cinnabar-border bg-cinnabar text-white' : 'border-border bg-paper-input text-muted hover:text-ink'}`}
        >
          {t(locale, 'quote.viewList')}
        </button>
        <button
          onClick={() => setView('cloud')}
          className={`rounded-sm border px-3 py-1.5 text-xs font-medium transition ${view === 'cloud' ? 'border-cinnabar-border bg-cinnabar text-white' : 'border-border bg-paper-input text-muted hover:text-ink'}`}
        >
          {t(locale, 'quote.viewCloud')}
        </button>
      </div>
```

When `view === 'cloud'`, render the cloud and return early from the body section:

```tsx
      {view === 'cloud' ? (
        <TagCloud
          quotes={cloudQuotes}
          selectedTags={selectedTags}
          onSelect={(tag) => { onToggleTag(tag); setView('list'); }}
          onRename={onRenameTag}
          onDelete={onDeleteTag}
          locale={locale}
        />
      ) : (
        <>
          {selectedTags.size > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {[...selectedTags].map((tag) => (
                <button
                  key={tag}
                  onClick={() => onToggleTag(tag)}
                  className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar px-2 py-1 text-xs text-white"
                >
                  #{tag} ×
                </button>
              ))}
            </div>
          )}
          {/* existing parked filter bar + grid go here */}
        </>
      )}
```

Move the existing parked-filter bar and grid inside that `list`-branch `<>...</>`. Keep the empty-state early return (`quotes.length === 0`) as-is, but note `quotes` now means the tag-filtered set; that is the intended List behavior.

- [ ] **Step 6: Pass the new props from `App`**

In `entrypoints/dashboard/App.tsx` `<QuoteList>` render:

```tsx
            <QuoteList
              quotes={matches.quotes}
              cloudQuotes={matches.quotesByQueryStatus}
              onUpdate={updateQuote}
              onDelete={deleteQuote}
              onSetTags={setQuoteTags}
              knownTags={knownTags}
              selectedTags={selectedTags}
              onToggleTag={toggleTag}
              onRenameTag={renameTagEverywhere}
              onDeleteTag={deleteTagEverywhere}
              locale={locale}
            />
```

> `TagCloud` is created in Task 9. To keep this task's commit compiling, create a minimal stub `entrypoints/dashboard/components/TagCloud.tsx` now (Task 9 fleshes it out):
> ```tsx
> import type { QuoteEntry, UiLocale } from '@/lib/types';
> export function TagCloud(_props: {
>   quotes: QuoteEntry[];
>   selectedTags: Set<string>;
>   onSelect: (tag: string) => void;
>   onRename: (from: string, to: string) => void;
>   onDelete: (tag: string) => void;
>   locale: UiLocale;
> }) {
>   return null;
> }
> ```

- [ ] **Step 7: Test the sub-tab + filter behavior**

Add to `tests/quote-list.test.tsx`:

```tsx
it('switches to Cloud view and back to List', () => {
  render(
    <QuoteList
      quotes={[]} cloudQuotes={[]} onUpdate={() => {}} onDelete={() => {}}
      onSetTags={() => {}} knownTags={[]} selectedTags={new Set()}
      onToggleTag={() => {}} onRenameTag={() => {}} onDeleteTag={() => {}} locale="en"
    />,
  );
  fireEvent.click(screen.getByText('Cloud'));
  fireEvent.click(screen.getByText('List'));
  // No throw; List tab active again.
  expect(screen.getByText('List')).toBeTruthy();
});
```

Run: `npx vitest run tests/quote-list.test.tsx tests/quote-filter.test.ts`
Expected: PASS.

- [ ] **Step 8: Typecheck and commit**

```bash
npm run compile
git add entrypoints/dashboard/App.tsx entrypoints/dashboard/components/QuoteList.tsx entrypoints/dashboard/components/TagCloud.tsx lib/tags.ts lib/i18n.ts tests/quote-filter.test.ts tests/quote-list.test.tsx
git commit -m "feat(quotes): OR tag filtering + List|Cloud sub-tabs"
```

---

## Task 9: TagCloud component + inline rename/delete-everywhere

**Files:**
- Modify: `entrypoints/dashboard/components/TagCloud.tsx` (replace the stub)
- Modify: `lib/i18n.ts` (cloud strings)
- Test: `tests/tag-cloud.test.tsx`

**Interfaces:**
- Consumes: `tagCounts` from `lib/tags`; `onSelect`, `onRename`, `onDelete` callbacks.
- Produces: the rendered cloud (font-size scaled by frequency) with per-tag rename + delete actions, each behind a confirm.

- [ ] **Step 1: Write the failing component test**

Create `tests/tag-cloud.test.tsx`:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TagCloud } from '../entrypoints/dashboard/components/TagCloud';
import type { QuoteEntry } from '../lib/types';

const q = (id: string, tags: string[]) => ({ id, tags } as QuoteEntry);

describe('TagCloud', () => {
  it('renders each tag once, sized by frequency', () => {
    render(
      <TagCloud
        quotes={[q('1', ['a', 'b']), q('2', ['a'])]}
        selectedTags={new Set()}
        onSelect={() => {}} onRename={() => {}} onDelete={() => {}} locale="en"
      />,
    );
    const a = screen.getByText('a');
    const b = screen.getByText('b');
    const aSize = parseFloat((a as HTMLElement).style.fontSize);
    const bSize = parseFloat((b as HTMLElement).style.fontSize);
    expect(aSize).toBeGreaterThan(bSize); // a appears twice, b once
  });

  it('calls onSelect when a tag is clicked', () => {
    const onSelect = vi.fn();
    render(<TagCloud quotes={[q('1', ['a'])]} selectedTags={new Set()} onSelect={onSelect} onRename={() => {}} onDelete={() => {}} locale="en" />);
    fireEvent.click(screen.getByText('a'));
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('calls onDelete after confirm', () => {
    const onDelete = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TagCloud quotes={[q('1', ['a'])]} selectedTags={new Set()} onSelect={() => {}} onRename={() => {}} onDelete={onDelete} locale="en" />);
    fireEvent.click(screen.getByLabelText('Delete tag a everywhere'));
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('calls onRename with the prompt value after confirm', () => {
    const onRename = vi.fn();
    vi.spyOn(window, 'prompt').mockReturnValue('b');
    render(<TagCloud quotes={[q('1', ['a'])]} selectedTags={new Set()} onSelect={() => {}} onRename={onRename} onDelete={() => {}} locale="en" />);
    fireEvent.click(screen.getByLabelText('Rename tag a'));
    expect(onRename).toHaveBeenCalledWith('a', 'b');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/tag-cloud.test.tsx`
Expected: FAIL — the stub renders `null`.

- [ ] **Step 3: Add the i18n strings**

In `lib/i18n.ts`, add to **both** locale blocks:
- `en`: `'cloud.empty': 'No tags yet.',` `'cloud.rename': 'Rename tag {tag}',` `'cloud.delete': 'Delete tag {tag} everywhere',` `'cloud.renamePrompt': 'Rename tag "{tag}" to:',` `'cloud.deleteConfirm': 'Delete the tag "{tag}" from all quotes?',`
- `zh-CN`: `'cloud.empty': '还没有标签。',` `'cloud.rename': '重命名标签 {tag}',` `'cloud.delete': '在所有句子中删除标签 {tag}',` `'cloud.renamePrompt': '将标签“{tag}”重命名为：',` `'cloud.deleteConfirm': '从所有句子中删除标签“{tag}”？',`

- [ ] **Step 4: Implement `TagCloud`**

Replace `entrypoints/dashboard/components/TagCloud.tsx`:

```tsx
import { formatMessage, t } from '@/lib/i18n';
import { tagCounts } from '@/lib/tags';
import type { QuoteEntry, UiLocale } from '@/lib/types';

export function TagCloud({
  quotes,
  selectedTags,
  onSelect,
  onRename,
  onDelete,
  locale,
}: {
  quotes: QuoteEntry[];
  selectedTags: Set<string>;
  onSelect: (tag: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
  locale: UiLocale;
}) {
  const counts = [...tagCounts(quotes).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (counts.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-10 text-center">
        <p className="text-sm text-muted">{t(locale, 'cloud.empty')}</p>
      </div>
    );
  }

  const max = counts[0][1];
  const min = counts[counts.length - 1][1];
  const sizeFor = (count: number) => {
    if (max === min) return 1;
    return 0.85 + (1.6 * (count - min)) / (max - min); // rem, 0.85–2.45
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-border bg-paper-light p-4">
      {counts.map(([tag, count]) => (
        <span key={tag} className="group inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelect(tag)}
            style={{ fontSize: `${sizeFor(count)}rem` }}
            className={`leading-none transition hover:text-cinnabar ${selectedTags.has(tag) ? 'text-cinnabar' : 'text-ink'}`}
          >
            {tag}
          </button>
          <button
            type="button"
            aria-label={formatMessage(locale, 'cloud.rename', { tag })}
            onClick={() => {
              const next = window.prompt(formatMessage(locale, 'cloud.renamePrompt', { tag }), tag);
              if (next && next.trim() !== '') onRename(tag, next);
            }}
            className="text-xs text-muted opacity-0 transition hover:text-ink group-hover:opacity-100"
          >
            ✎
          </button>
          <button
            type="button"
            aria-label={formatMessage(locale, 'cloud.delete', { tag })}
            onClick={() => {
              if (window.confirm(formatMessage(locale, 'cloud.deleteConfirm', { tag }))) onDelete(tag);
            }}
            className="text-xs text-muted opacity-0 transition hover:text-cinnabar group-hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
```

- [ ] **Step 5: Run the component tests**

Run: `npx vitest run tests/tag-cloud.test.tsx`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm run compile && npx vitest run`
Expected: PASS across the board.

- [ ] **Step 7: Commit**

```bash
git add entrypoints/dashboard/components/TagCloud.tsx lib/i18n.ts tests/tag-cloud.test.tsx
git commit -m "feat(quotes): TagCloud with frequency sizing + inline rename/delete-everywhere"
```

---

## Self-Review

**1. Spec coverage**

| Spec item | Task |
| --- | --- |
| `lib/tags.ts` helpers (normalize/add/remove/counts) | Task 1 |
| Storage migration category→tags (uncategorized dropped, dedupe, idempotent) | Task 2 |
| Type change: remove `category` | Task 5 |
| `QuoteNode` `tags`/`tagTombstones` maps (optional) | Task 3 |
| Projection carry-forward add stamp + re-add `+1` | Task 3 |
| `mergeQuoteNodes` merges stamp maps via `liftLegacyTags` | Task 3 |
| `materialize` reads OR-Set, drops category default | Task 3 (read) + Task 5 (drop category) |
| Cross-version `liftLegacyTags` + crash-safety `?? {}` | Task 3 |
| `prev` threaded from coordinator | Task 3 (Step 6) |
| `removeTags` batched mutation + `applyTagRemoval` + handler | Task 4 |
| Dashboard `setQuoteTags`; rename/delete-everywhere (single mutate + one batched mutation) | Task 6 |
| QuoteCard chip editor + autocomplete (all-quotes vocabulary) | Task 7 |
| Filtering OR + selectedTags lifted to App | Task 8 |
| List \| Cloud sub-tabs; cloud counts query+status, ignores tag filter | Task 8 (split sets) + Task 9 |
| ReviewQueue tag badges | Task 5 (Step 10) |
| Search/export/backup category drop + restore migration | Task 5 |
| TagCloud frequency sizing + inline rename/delete with confirm | Task 9 |
| Tests: tags, migration, OR-Set (incl. resurrection regression), applyTagRemoval, filtering, TagCloud, QuoteCard | Tasks 1–9 |

No uncovered spec requirement found. The spec's "add-stamp stability test" and "resurrection regression" are both in Task 3 (Steps 2 & 9); the same-millisecond re-add is Task 3 Step 2; the legacy-register-after-tombstone guard is exercised by `liftLegacyTags` + merge tests in Task 3 (the merge keeps the older register stamp below a tombstone).

**2. Placeholder scan**

The only intentional interim stub is `TagCloud.tsx` in Task 8 Step 6, explicitly replaced in Task 9 — flagged inline, not a hidden placeholder. All code steps contain complete implementations. No "TBD"/"add error handling"/"similar to Task N".

**3. Type consistency**

- `setQuoteTags(id, nextTags)` (Task 6) ↔ `QuoteList.onSetTags(id, nextTags)` (Task 6) ↔ `QuoteCard.onSetTags(nextTags)` (Tasks 6/7) — consistent.
- `applyTagRemoval(removals: Array<{quoteId, tags}>)` (Task 4) ↔ payload `{ removals }` sent by `setQuoteTags`/rename/delete (Task 6) ↔ handler destructures `{ removals }` (Task 4) — consistent.
- `projectInbox(..., persisted?)` (Task 3) ↔ coordinator call (Task 3 Step 6) ↔ `reconcileOnStartup` 4-arg call (unchanged, defaults `undefined`) — consistent.
- `liftLegacyTags` exported from `project.ts`, imported by `merge.ts` (Task 3) — no circular runtime issue (merge already imports from `./registers`; `project.ts` does not import from `merge.ts`, so the new `merge → project` import is one-directional).
- `quoteMatchesTags` / `tagCounts` / `planTagWrite` / `migrateQuoteCategoryToTags` signatures match every call site.

One note for the implementer: confirm `merge.ts` importing `liftLegacyTags` from `project.ts` does not create a cycle — `project.ts` imports from `./registers` and `./types` only, not `./merge`, so this is safe.

---

**Plan complete and saved to `docs/superpowers/plans/2026-06-27-quote-tags-system.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
