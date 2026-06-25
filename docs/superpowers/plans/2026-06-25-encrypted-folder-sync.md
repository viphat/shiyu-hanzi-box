# Encrypted Provider-Neutral Folder Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional, encrypted, provider-neutral bidirectional folder sync so multiple browser profiles converge their words, quotes, settings, AI settings, and SRS state through a user-selected folder, while `chrome.storage.local` stays authoritative for local use.

**Architecture:** A CRDT-style sync layer keeps a per-replica, versioned `SyncState` derived from the existing domain objects. Pure modules (`lib/sync/*`) own clock, merge, projection, crypto, and vault parsing with no browser APIs. Browser APIs (File System Access, `chrome.storage.local`, `chrome.alarms`) live at the edges: a serialized coordinator and a background sole-writer mutation broker. The selected folder holds an encrypted per-replica snapshot file plus plaintext `vault.json`; the extension reads all replicas, merges deterministically, and writes only its own replica.

**Tech Stack:** TypeScript, WXT (`storage.defineItem`, `defineBackground`), React 19 (settings/dashboard UI), Web Crypto (PBKDF2 + AES-256-GCM), File System Access API, IndexedDB (directory-handle persistence), Vitest + `@webext-core/fake-browser` for tests.

## Global Constraints

- Sync is disabled by default; no eager migration of existing installs.
- `chrome.storage.local` remains authoritative; sync failures never roll back valid local work.
- All synchronized writes flow through the background sole-writer broker; no other context writes synchronized storage keys.
- `lib/srs.ts` remains the **only** importer of `ts-fsrs`. The merge layer selects persisted scheduler snapshots; it never constructs an FSRS scheduler.
- Capture continues to funnel through `lib/capture.ts`.
- Sync format version = `1`; vault format version = `1`. Readers reject unknown major formats without modifying files.
- KDF: PBKDF2-HMAC-SHA-256, 600,000 iterations (floor), 128-bit salt, 256-bit key. Encryption: AES-256-GCM, fresh random 96-bit nonce per write. KDF/cipher params are versioned in `vault.json`.
- The encrypted payload exposes only `{ header, nonce, ciphertext }`. No user text, URLs, settings, API keys, timestamps, or labels in plaintext.
- `queueRank` is never synchronized; it is recomputed locally after merge.
- New visible UI strings are added in English and Simplified Chinese via `lib/i18n.ts`.
- Pure `lib/sync/*` modules must not import browser globals (`chrome`, `browser`, `indexedDB`, `window`). Browser access is confined to `lib/sync/files.ts`, `lib/sync/local.ts`, the coordinator, the broker, and UI.
- The extension requests the `unlimitedStorage` permission.
- Replica IDs are interned to a per-state table; per-field stamps reference replicas by index, not inline string.
- Commands for every task: `npm run compile` (tsc), `npm test` (vitest run), `npm run build` (final).
- Tests live in `tests/`, import from `../lib/...`, and use `fakeBrowser` from `wxt/testing/fake-browser` when they touch storage.

---

## File Structure

**New pure modules (no browser APIs):**
- `lib/sync/types.ts` — envelope, `HybridTimestamp`, `SyncState`, registers, statuses, error codes.
- `lib/sync/clock.ts` — hybrid logical clock creation, observation, total comparison.
- `lib/sync/registers.ts` — last-write-wins register + observed-remove set primitives.
- `lib/sync/project.ts` — domain ⇄ `SyncState` projection, materialization, legacy bootstrap IDs.
- `lib/sync/merge.ts` — deterministic merge of two `SyncState` values.
- `lib/sync/crypto.ts` — Web Crypto KDF, verification, AES-GCM encrypt/decrypt (uses `crypto.subtle`, no extension APIs).
- `lib/sync/vault.ts` — `vault.json` + replica envelope parsing/validation.

**New browser-edge modules:**
- `lib/sync/files.ts` — `FileSystemDirectoryHandle` traversal/reads/writes behind a narrow adapter interface; ships an in-memory fake for tests.
- `lib/sync/local.ts` — local replica config, sync metadata, pending status, handle persistence in IndexedDB.
- `lib/sync/mutations.ts` — revisioned domain+metadata mutation protocol and interrupted-write reconciliation.
- `lib/sync/coordinator.ts` — serialized sync orchestration and trigger coalescing (alarm-driven).
- `entrypoints/background/sync-mutation-handler.ts` — sole-writer message broker.

**Modified:**
- `lib/types.ts` — add `unlimitedStorage` note only via manifest; no domain shape change required (sync IDs live in metadata).
- `lib/backup.ts` — add versioned full-backup envelope (inbox + app settings + AI settings).
- `lib/i18n.ts` — new strings.
- `entrypoints/background/index.ts` — register broker + alarms.
- `entrypoints/settings/*` — Folder Sync section.
- `entrypoints/dashboard/*` — toolbar sync status control.
- `wxt.config.ts` — `unlimitedStorage` permission.

---

## Phase 0 — Foundation: types & clock

### Task 1: Sync types module

**Files:**
- Create: `lib/sync/types.ts`
- Test: `tests/sync/types.test.ts`

**Interfaces:**
- Consumes: existing `lib/types.ts` (`Status`, `ReviewState`, `Occurrence`).
- Produces:
  - `interface HybridTimestamp { wallTime: number; counter: number; replicaId: string }`
  - `interface Register<T> { value: T; stamp: HybridTimestamp }`
  - `const SYNC_FORMAT_VERSION = 1`, `const VAULT_FORMAT_VERSION = 1`, `const APP_ID = 'shiyu-hanzi-box'`
  - `interface SyncState` with sections: `replicas: string[]` (interning table), `words`, `quotes`, `tombstones`, `appSettings`, `aiSettings`, `kaikkiSource`.
  - Node types: `WordNode`, `QuoteNode`, `OccurrenceNode`, `ReviewEventNode`, `SchedulerSnapshotNode`.
  - `type SyncStatus = 'disabled' | 'synced' | 'syncing' | 'pending' | 'needs-attention'`
  - `type SyncErrorCode` enumerating: `'unsupported' | 'disconnected' | 'locked' | 'wrong-passphrase' | 'needs-reauthorization' | 'folder-unavailable' | 'vault-invalid' | 'replica-incompatible' | 'local-validation' | 'write-failure' | 'clock-skew'`
  - `interface SyncReplica { app: typeof APP_ID; formatVersion: 1; vaultId: string; replicaId: string; writtenAt: HybridTimestamp; state: SyncState }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/types.test.ts
import { describe, expect, it } from 'vitest';
import {
  APP_ID,
  SYNC_FORMAT_VERSION,
  VAULT_FORMAT_VERSION,
  type HybridTimestamp,
  type Register,
  type SyncReplica,
  type SyncState,
} from '../../lib/sync/types';

describe('sync types', () => {
  it('exposes stable app and version constants', () => {
    expect(APP_ID).toBe('shiyu-hanzi-box');
    expect(SYNC_FORMAT_VERSION).toBe(1);
    expect(VAULT_FORMAT_VERSION).toBe(1);
  });

  it('models a replica envelope that wraps sync state', () => {
    const stamp: HybridTimestamp = { wallTime: 1, counter: 0, replicaId: 'R1' };
    const state: SyncState = {
      replicas: ['R1'],
      words: {},
      quotes: {},
      tombstones: {},
      appSettings: {},
      aiSettings: {},
      kaikkiSource: {},
    };
    const replica: SyncReplica = {
      app: APP_ID,
      formatVersion: 1,
      vaultId: 'V1',
      replicaId: 'R1',
      writtenAt: stamp,
      state,
    };
    const reg: Register<string> = { value: 'hi', stamp };
    expect(replica.state.replicas).toEqual(['R1']);
    expect(reg.value).toBe('hi');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/types.test.ts`
Expected: FAIL — cannot resolve `../../lib/sync/types`.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/types.ts
import type { Status } from '../types';

export const APP_ID = 'shiyu-hanzi-box' as const;
export const SYNC_FORMAT_VERSION = 1 as const;
export const VAULT_FORMAT_VERSION = 1 as const;

export interface HybridTimestamp {
  wallTime: number;
  counter: number;
  replicaId: string;
}

export interface Register<T> {
  value: T;
  stamp: HybridTimestamp;
}

/** Occurrence value as projected into sync state (mirrors lib/types Occurrence). */
export interface OccurrenceNode {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number;
  stamp: HybridTimestamp;
}

/** One review event, unioned by stable id. */
export interface ReviewEventNode {
  id: string;
  reviewedAt: number;
  eventVersion: number;
  /** Opaque persisted ReviewLogEntry payload; merge never interprets it. */
  payload: unknown;
  stamp: HybridTimestamp;
}

/** Scheduler snapshot fields that move together, tied to the winning review. */
export interface SchedulerSnapshotNode {
  /** Opaque persisted scheduler subset of ReviewState (no queueRank). */
  payload: unknown;
  /** Id of the review event this snapshot belongs to. */
  reviewEventId: string;
  stamp: HybridTimestamp;
}

export interface WordNode {
  /** Logical key value: normalized text. */
  normalized: string;
  /** Canonical public id chosen by earliest createdAt then smallest id. */
  fields: Record<string, Register<unknown>>;
  createdAt: Register<number>;
  occurrences: Record<string, OccurrenceNode>;
  occurrenceTombstones: Record<string, HybridTimestamp>;
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}

export interface QuoteNode {
  id: string;
  fields: Record<string, Register<unknown>>;
  createdAt: Register<number>;
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}

export interface SyncState {
  /** Interning table; stamps reference replicas by this list's index elsewhere if needed. */
  replicas: string[];
  /** Keyed by `word:<normalized>`. */
  words: Record<string, WordNode>;
  /** Keyed by quote entry id. */
  quotes: Record<string, QuoteNode>;
  /** Entity logical key -> delete stamp. */
  tombstones: Record<string, HybridTimestamp>;
  appSettings: Record<string, Register<unknown>>;
  aiSettings: Record<string, Register<unknown>>;
  kaikkiSource: Record<string, Register<unknown>>;
}

export interface SyncReplica {
  app: typeof APP_ID;
  formatVersion: 1;
  vaultId: string;
  replicaId: string;
  writtenAt: HybridTimestamp;
  state: SyncState;
}

export type SyncStatus =
  | 'disabled'
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'needs-attention';

export type SyncErrorCode =
  | 'unsupported'
  | 'disconnected'
  | 'locked'
  | 'wrong-passphrase'
  | 'needs-reauthorization'
  | 'folder-unavailable'
  | 'vault-invalid'
  | 'replica-incompatible'
  | 'local-validation'
  | 'write-failure'
  | 'clock-skew';

export interface SyncError {
  code: SyncErrorCode;
  /** Optional replica filename for replica-specific warnings. */
  replica?: string;
}

export const EMPTY_SYNC_STATE: SyncState = {
  replicas: [],
  words: {},
  quotes: {},
  tombstones: {},
  appSettings: {},
  aiSettings: {},
  kaikkiSource: {},
};

export type { Status };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sync/types.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/types.ts tests/sync/types.test.ts
git commit -m "feat(sync): add sync envelope and state types"
```

---

### Task 2: Hybrid logical clock

**Files:**
- Create: `lib/sync/clock.ts`
- Test: `tests/sync/clock.test.ts`

**Interfaces:**
- Consumes: `HybridTimestamp` from `lib/sync/types`.
- Produces:
  - `function compareTimestamps(a: HybridTimestamp, b: HybridTimestamp): number` — total order by `wallTime`, then `counter`, then `replicaId`.
  - `function createClock(replicaId: string, last?: HybridTimestamp): HybridClock`
  - `interface HybridClock { tick(wallTime: number): HybridTimestamp; observe(remote: HybridTimestamp, wallTime: number): void; last(): HybridTimestamp | undefined }`
  - `function skewMillis(remote: HybridTimestamp, wallTime: number): number` — `remote.wallTime - wallTime`.

Wall time is always passed in (never read from `Date.now()` inside this module) so tests are deterministic and the module stays pure.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/clock.test.ts
import { describe, expect, it } from 'vitest';
import { compareTimestamps, createClock, skewMillis } from '../../lib/sync/clock';

describe('compareTimestamps', () => {
  it('orders by wallTime, then counter, then replicaId', () => {
    const a = { wallTime: 1, counter: 0, replicaId: 'A' };
    const b = { wallTime: 2, counter: 0, replicaId: 'A' };
    const c = { wallTime: 1, counter: 1, replicaId: 'A' };
    const d = { wallTime: 1, counter: 0, replicaId: 'B' };
    expect(compareTimestamps(a, b)).toBeLessThan(0);
    expect(compareTimestamps(a, c)).toBeLessThan(0);
    expect(compareTimestamps(a, d)).toBeLessThan(0);
    expect(compareTimestamps(a, { ...a })).toBe(0);
  });
});

describe('createClock', () => {
  it('advances counter when wall time does not move', () => {
    const clock = createClock('A');
    const t1 = clock.tick(1000);
    const t2 = clock.tick(1000);
    expect(t1).toEqual({ wallTime: 1000, counter: 0, replicaId: 'A' });
    expect(t2).toEqual({ wallTime: 1000, counter: 1, replicaId: 'A' });
  });

  it('resets counter when wall time advances', () => {
    const clock = createClock('A');
    clock.tick(1000);
    expect(clock.tick(2000)).toEqual({ wallTime: 2000, counter: 0, replicaId: 'A' });
  });

  it('never regresses below an observed remote timestamp', () => {
    const clock = createClock('A');
    clock.observe({ wallTime: 5000, counter: 3, replicaId: 'B' }, 1000);
    const next = clock.tick(1000);
    expect(next.wallTime).toBe(5000);
    expect(next.counter).toBe(4);
  });

  it('reports clock skew in milliseconds', () => {
    expect(skewMillis({ wallTime: 5000, counter: 0, replicaId: 'B' }, 1000)).toBe(4000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/clock.test.ts`
Expected: FAIL — cannot resolve `../../lib/sync/clock`.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/clock.ts
import type { HybridTimestamp } from './types';

export function compareTimestamps(a: HybridTimestamp, b: HybridTimestamp): number {
  if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
  if (a.counter !== b.counter) return a.counter - b.counter;
  if (a.replicaId < b.replicaId) return -1;
  if (a.replicaId > b.replicaId) return 1;
  return 0;
}

export function skewMillis(remote: HybridTimestamp, wallTime: number): number {
  return remote.wallTime - wallTime;
}

export interface HybridClock {
  tick(wallTime: number): HybridTimestamp;
  observe(remote: HybridTimestamp, wallTime: number): void;
  last(): HybridTimestamp | undefined;
}

export function createClock(replicaId: string, last?: HybridTimestamp): HybridClock {
  let current: HybridTimestamp | undefined = last;

  function advance(wallTime: number): HybridTimestamp {
    const baseWall = current ? Math.max(current.wallTime, wallTime) : wallTime;
    let counter: number;
    if (current && current.wallTime === baseWall) {
      counter = current.counter + 1;
    } else {
      counter = 0;
    }
    current = { wallTime: baseWall, counter, replicaId };
    return current;
  }

  return {
    tick: advance,
    observe(remote: HybridTimestamp, wallTime: number) {
      const wall = Math.max(current?.wallTime ?? 0, remote.wallTime, wallTime);
      const counter =
        current && current.wallTime === wall
          ? Math.max(current.counter, remote.wallTime === wall ? remote.counter : 0) + 1
          : remote.wallTime === wall
            ? remote.counter + 1
            : 0;
      current = { wallTime: wall, counter, replicaId };
    },
    last() {
      return current;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sync/clock.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/clock.ts tests/sync/clock.test.ts
git commit -m "feat(sync): add hybrid logical clock with total ordering"
```

---

## Phase 1 — Pure merge core

### Task 3: Register and observed-remove primitives

**Files:**
- Create: `lib/sync/registers.ts`
- Test: `tests/sync/registers.test.ts`

**Interfaces:**
- Consumes: `Register`, `HybridTimestamp` from `lib/sync/types`; `compareTimestamps` from `lib/sync/clock`.
- Produces:
  - `function mergeRegister<T>(a: Register<T> | undefined, b: Register<T> | undefined): Register<T>` — higher stamp wins; deterministic.
  - `function mergeRegisterMap(a, b): Record<string, Register<unknown>>` — per-key LWW.
  - `function mergeStampMap(a, b): Record<string, HybridTimestamp>` — per-key max stamp (for tombstones/occurrence tombstones).
  - `function isSuppressed(stamp: HybridTimestamp | undefined, tombstone: HybridTimestamp | undefined): boolean` — true when tombstone ≥ stamp.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/registers.test.ts
import { describe, expect, it } from 'vitest';
import {
  isSuppressed,
  mergeRegister,
  mergeRegisterMap,
  mergeStampMap,
} from '../../lib/sync/registers';

const ts = (wallTime: number, replicaId = 'A', counter = 0) => ({ wallTime, counter, replicaId });

describe('mergeRegister', () => {
  it('keeps the higher-stamped value', () => {
    const older = { value: 'old', stamp: ts(1) };
    const newer = { value: 'new', stamp: ts(2) };
    expect(mergeRegister(older, newer).value).toBe('new');
    expect(mergeRegister(newer, older).value).toBe('new');
  });

  it('is deterministic on equal wall time via replica tie-break', () => {
    const a = { value: 'a', stamp: ts(1, 'A') };
    const b = { value: 'b', stamp: ts(1, 'B') };
    expect(mergeRegister(a, b).value).toBe('b');
    expect(mergeRegister(b, a).value).toBe('b');
  });

  it('returns the defined side when one is missing', () => {
    const a = { value: 'a', stamp: ts(1) };
    expect(mergeRegister(a, undefined)).toBe(a);
    expect(mergeRegister(undefined, a)).toBe(a);
  });
});

describe('mergeStampMap', () => {
  it('keeps the max stamp per key', () => {
    const merged = mergeStampMap({ k: ts(1) }, { k: ts(2) });
    expect(merged.k.wallTime).toBe(2);
  });
});

describe('isSuppressed', () => {
  it('suppresses values at or below the tombstone', () => {
    expect(isSuppressed(ts(1), ts(2))).toBe(true);
    expect(isSuppressed(ts(3), ts(2))).toBe(false);
    expect(isSuppressed(ts(1), undefined)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/registers.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/registers.ts
import { compareTimestamps } from './clock';
import type { HybridTimestamp, Register } from './types';

export function mergeRegister<T>(
  a: Register<T> | undefined,
  b: Register<T> | undefined,
): Register<T> {
  if (!a) return b as Register<T>;
  if (!b) return a;
  return compareTimestamps(a.stamp, b.stamp) >= 0 ? a : b;
}

export function mergeRegisterMap(
  a: Record<string, Register<unknown>>,
  b: Record<string, Register<unknown>>,
): Record<string, Register<unknown>> {
  const out: Record<string, Register<unknown>> = { ...a };
  for (const key of Object.keys(b)) {
    out[key] = mergeRegister(out[key], b[key]);
  }
  return out;
}

export function mergeStampMap(
  a: Record<string, HybridTimestamp>,
  b: Record<string, HybridTimestamp>,
): Record<string, HybridTimestamp> {
  const out: Record<string, HybridTimestamp> = { ...a };
  for (const key of Object.keys(b)) {
    const existing = out[key];
    out[key] = !existing || compareTimestamps(b[key], existing) > 0 ? b[key] : existing;
  }
  return out;
}

export function isSuppressed(
  stamp: HybridTimestamp | undefined,
  tombstone: HybridTimestamp | undefined,
): boolean {
  if (!tombstone || !stamp) return false;
  return compareTimestamps(tombstone, stamp) >= 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/sync/registers.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/registers.ts tests/sync/registers.test.ts
git commit -m "feat(sync): add LWW register and tombstone primitives"
```

---

### Task 4: Projection and legacy bootstrap IDs

**Files:**
- Create: `lib/sync/project.ts`
- Test: `tests/sync/project.test.ts`

**Interfaces:**
- Consumes: `lib/types` (`Inbox`, `WordEntry`, `QuoteEntry`, `Occurrence`, `AppSettings`, `AiSettings`, `ReviewState`); `lib/sync/types`; `lib/sync/clock` (`createClock`).
- Produces:
  - `function wordKey(normalized: string): string` → `` `word:${normalized}` ``.
  - `function legacyOccurrenceId(wordId: string, occ: Occurrence): string` — deterministic, derived from `wordId` + canonical `sourceUrl|surrounding|capturedAt`.
  - `function legacyReviewEventId(entityKey: string, reviewedAt: number, index: number): string`.
  - `interface BootstrapContext { replicaId: string; wallTime: number }`
  - `function projectInbox(inbox: Inbox, settings: AppSettings, ai: AiSettings, ctx: BootstrapContext): SyncState` — derives stamps from `updatedAt`/`capturedAt`/`reviewedAt`.
  - `function materialize(state: SyncState): { inbox: Inbox; portableSettings: { uiLocale; srs }; ai: AiSettings; kaikkiSource: { sourceUrl: string; sourceName: string } }` — applies tombstones, picks canonical word IDs, sorts deterministically.
  - `const PORTABLE_APP_FIELDS = ['uiLocale', 'srs.desiredRetention', ...]` and `const AI_FIELDS = ['enabled','provider','baseUrl','apiKey','model']` documenting which leaves project.

Canonicalization rule for `legacyOccurrenceId`: `${wordId}|${sourceUrl} ${surrounding} ${capturedAt}` hashed with a small non-crypto string hash (FNV-1a) rendered base36; no `crypto` dependency so the module stays pure and synchronous.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/project.test.ts
import { describe, expect, it } from 'vitest';
import {
  legacyOccurrenceId,
  materialize,
  projectInbox,
  wordKey,
} from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { Inbox, WordEntry } from '../../lib/types';

const ctx = { replicaId: 'A', wallTime: 1000 };

function wordFixture(over: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences: [
      { sourceTitle: 't', sourceUrl: 'u', sourceDomain: 'd', surrounding: 's', capturedAt: 15 },
    ],
    ...over,
  };
}

describe('projection identity', () => {
  it('keys words by normalized text', () => {
    expect(wordKey('你好')).toBe('word:你好');
  });

  it('derives stable, deterministic legacy occurrence ids', () => {
    const occ = { sourceTitle: 't', sourceUrl: 'u', sourceDomain: 'd', surrounding: 's', capturedAt: 15 };
    expect(legacyOccurrenceId('w1', occ)).toBe(legacyOccurrenceId('w1', { ...occ }));
    expect(legacyOccurrenceId('w1', occ)).not.toBe(legacyOccurrenceId('w2', occ));
  });
});

describe('project then materialize round-trip', () => {
  it('preserves a word and its occurrence', () => {
    const inbox: Inbox = { words: [wordFixture()], quotes: [] };
    const state = projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);
    const out = materialize(state);
    expect(out.inbox.words).toHaveLength(1);
    expect(out.inbox.words[0].normalized).toBe('你好');
    expect(out.inbox.words[0].occurrences).toHaveLength(1);
  });

  it('projects portable AI fields including the api key', () => {
    const inbox: Inbox = { words: [], quotes: [] };
    const ai = { ...DEFAULT_AI_SETTINGS, apiKey: 'secret', enabled: true };
    const state = projectInbox(inbox, DEFAULT_SETTINGS, ai, ctx);
    expect(materialize(state).ai.apiKey).toBe('secret');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/project.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/project.ts
import type {
  AiSettings,
  AppSettings,
  Inbox,
  Occurrence,
  QuoteEntry,
  ReviewState,
  WordEntry,
} from '../types';
import type {
  HybridTimestamp,
  OccurrenceNode,
  QuoteNode,
  Register,
  SyncState,
  WordNode,
} from './types';
import { EMPTY_SYNC_STATE } from './types';

export function wordKey(normalized: string): string {
  return `word:${normalized}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export function legacyOccurrenceId(wordId: string, occ: Occurrence): string {
  return `occ:${fnv1a(`${wordId}|${occ.sourceUrl} ${occ.surrounding} ${occ.capturedAt}`)}`;
}

export function legacyReviewEventId(entityKey: string, reviewedAt: number, index: number): string {
  return `rev:${fnv1a(`${entityKey} ${reviewedAt} ${index}`)}`;
}

export const AI_FIELDS = ['enabled', 'provider', 'baseUrl', 'apiKey', 'model'] as const;

function stamp(wallTime: number, replicaId: string, counter = 0): HybridTimestamp {
  return { wallTime, counter, replicaId };
}

function reg<T>(value: T, s: HybridTimestamp): Register<T> {
  return { value, stamp: s };
}

interface BootstrapContext {
  replicaId: string;
  wallTime: number;
}

function projectScheduler(
  entityKey: string,
  review: ReviewState | undefined,
  replicaId: string,
): Pick<WordNode, 'reviewEvents' | 'snapshot'> {
  const reviewEvents: WordNode['reviewEvents'] = {};
  if (!review) return { reviewEvents, snapshot: undefined };
  const log = review.reviewLog ?? [];
  let latestId: string | undefined;
  log.forEach((entry, index) => {
    const id = legacyReviewEventId(entityKey, entry.reviewedAt, index);
    reviewEvents[id] = {
      id,
      reviewedAt: entry.reviewedAt,
      eventVersion: 1,
      payload: entry,
      stamp: stamp(entry.reviewedAt, replicaId),
    };
    latestId = id;
  });
  const { reviewLog: _log, queueRank: _rank, ...snapshotPayload } = review;
  const snapshot = latestId
    ? {
        payload: snapshotPayload,
        reviewEventId: latestId,
        stamp: stamp(review.lastReviewedAt ?? review.dueAt, replicaId),
      }
    : undefined;
  return { reviewEvents, snapshot };
}

function projectWord(word: WordEntry, ctx: BootstrapContext): WordNode {
  const key = wordKey(word.normalized);
  const s = stamp(word.updatedAt, ctx.replicaId);
  const occurrences: Record<string, OccurrenceNode> = {};
  for (const occ of word.occurrences) {
    const id = legacyOccurrenceId(word.id, occ);
    occurrences[id] = { id, ...occ, stamp: stamp(occ.capturedAt, ctx.replicaId) };
  }
  return {
    normalized: word.normalized,
    createdAt: reg(word.createdAt, stamp(word.createdAt, ctx.replicaId)),
    fields: {
      id: reg(word.id, s),
      text: reg(word.text, s),
      note: reg(word.note, s),
      status: reg(word.status, s),
      pinyin: reg(word.pinyin ?? null, s),
      traditionalText: reg(word.traditionalText ?? null, s),
      aiInsight: reg(word.aiInsight ?? null, s),
      updatedAt: reg(word.updatedAt, s),
    },
    occurrences,
    occurrenceTombstones: {},
    ...projectScheduler(key, word.review, ctx.replicaId),
  };
}

function projectQuote(quote: QuoteEntry, ctx: BootstrapContext): QuoteNode {
  const s = stamp(quote.updatedAt, ctx.replicaId);
  return {
    id: quote.id,
    createdAt: reg(quote.createdAt, stamp(quote.createdAt, ctx.replicaId)),
    fields: {
      text: reg(quote.text, s),
      note: reg(quote.note, s),
      status: reg(quote.status, s),
      category: reg(quote.category, s),
      tags: reg(quote.tags, s),
      sourceTitle: reg(quote.sourceTitle, s),
      sourceUrl: reg(quote.sourceUrl, s),
      sourceDomain: reg(quote.sourceDomain, s),
      surrounding: reg(quote.surrounding, s),
      pinyin: reg(quote.pinyin ?? null, s),
      traditionalText: reg(quote.traditionalText ?? null, s),
      updatedAt: reg(quote.updatedAt, s),
    },
    reviewEvents: projectScheduler(`quote:${quote.id}`, quote.review, ctx.replicaId).reviewEvents,
    snapshot: projectScheduler(`quote:${quote.id}`, quote.review, ctx.replicaId).snapshot,
  };
}

export function projectInbox(
  inbox: Inbox,
  settings: AppSettings,
  ai: AiSettings,
  ctx: BootstrapContext,
): SyncState {
  const s = stamp(ctx.wallTime, ctx.replicaId);
  const state: SyncState = {
    ...EMPTY_SYNC_STATE,
    replicas: [ctx.replicaId],
    words: {},
    quotes: {},
    tombstones: {},
    appSettings: {
      uiLocale: reg(settings.uiLocale, s),
      'srs.desiredRetention': reg(settings.srs.desiredRetention, s),
      'srs.maximumIntervalDays': reg(settings.srs.maximumIntervalDays, s),
      'srs.newCardsPerDay': reg(settings.srs.newCardsPerDay, s),
      'srs.enableFuzz': reg(settings.srs.enableFuzz, s),
    },
    aiSettings: Object.fromEntries(
      AI_FIELDS.map((f) => [f, reg((ai as Record<string, unknown>)[f], s)]),
    ),
    kaikkiSource: {
      sourceUrl: reg(settings.kaikki.sourceUrl, s),
      sourceName: reg(settings.kaikki.sourceName, s),
    },
  };
  for (const word of inbox.words) state.words[wordKey(word.normalized)] = projectWord(word, ctx);
  for (const quote of inbox.quotes) state.quotes[quote.id] = projectQuote(quote, ctx);
  return state;
}

// materialize is implemented in Task 5 alongside merge so it shares ordering helpers.
export { stamp as bootstrapStamp };
```

> Note: the test for `materialize` in Step 1 will still fail until Task 5 adds `materialize`. Mark Task 4 complete only after Step 4 below passes the projection-only assertions; move the round-trip `materialize` test to Task 5 if executing strictly task-by-task. (Both tasks ship together in the same phase.)

- [ ] **Step 4: Implement `materialize` minimally to pass the round-trip test**

Add to `lib/sync/project.ts`:

```ts
import { compareTimestamps } from './clock';
import { isSuppressed } from './registers';
import { DEFAULT_SETTINGS } from '../settings';
import { DEFAULT_AI_SETTINGS } from '../ai/settings';
import type { ReviewLogEntry } from '../types';

function pickWordId(node: WordNode): string {
  return (node.fields.id?.value as string) ?? '';
}

export function materialize(state: SyncState): {
  inbox: Inbox;
  portableSettings: { uiLocale: AppSettings['uiLocale']; srs: AppSettings['srs'] };
  ai: AiSettings;
  kaikkiSource: { sourceUrl: string; sourceName: string };
} {
  const words: WordEntry[] = [];
  for (const [key, node] of Object.entries(state.words)) {
    if (isSuppressed(node.fields.updatedAt?.stamp, state.tombstones[key])) continue;
    const occurrences: Occurrence[] = Object.values(node.occurrences)
      .filter((o) => !isSuppressed(o.stamp, node.occurrenceTombstones[o.id]))
      .sort((a, b) => a.capturedAt - b.capturedAt || a.id.localeCompare(b.id))
      .map(({ id: _id, stamp: _s, ...rest }) => rest);
    const review = rebuildReview(node);
    words.push({
      id: pickWordId(node),
      kind: 'word',
      text: node.fields.text?.value as string,
      normalized: node.normalized,
      note: (node.fields.note?.value as string) ?? '',
      status: node.fields.status?.value as WordEntry['status'],
      createdAt: node.createdAt.value,
      updatedAt: node.fields.updatedAt?.value as number,
      pinyin: (node.fields.pinyin?.value as string | null) ?? undefined,
      traditionalText: (node.fields.traditionalText?.value as string | null) ?? undefined,
      aiInsight: (node.fields.aiInsight?.value as WordEntry['aiInsight']) ?? undefined,
      occurrences,
      ...(review ? { review } : {}),
    });
  }
  words.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const quotes: QuoteEntry[] = [];
  for (const [id, node] of Object.entries(state.quotes)) {
    if (isSuppressed(node.fields.updatedAt?.stamp, state.tombstones[`quote:${id}`])) continue;
    const review = rebuildReview(node);
    quotes.push({
      id: node.id,
      kind: 'quote',
      text: node.fields.text?.value as string,
      note: (node.fields.note?.value as string) ?? '',
      status: node.fields.status?.value as QuoteEntry['status'],
      category: (node.fields.category?.value as string) ?? 'uncategorized',
      tags: (node.fields.tags?.value as string[]) ?? [],
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
  quotes.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));

  const get = (m: Record<string, Register<unknown>>, k: string, dflt: unknown) =>
    m[k] ? m[k].value : dflt;

  return {
    inbox: { words, quotes },
    portableSettings: {
      uiLocale: get(state.appSettings, 'uiLocale', DEFAULT_SETTINGS.uiLocale) as AppSettings['uiLocale'],
      srs: {
        desiredRetention: get(state.appSettings, 'srs.desiredRetention', DEFAULT_SETTINGS.srs.desiredRetention) as number,
        maximumIntervalDays: get(state.appSettings, 'srs.maximumIntervalDays', DEFAULT_SETTINGS.srs.maximumIntervalDays) as number,
        newCardsPerDay: get(state.appSettings, 'srs.newCardsPerDay', DEFAULT_SETTINGS.srs.newCardsPerDay) as number,
        enableFuzz: get(state.appSettings, 'srs.enableFuzz', DEFAULT_SETTINGS.srs.enableFuzz) as boolean,
      },
    },
    ai: {
      enabled: get(state.aiSettings, 'enabled', DEFAULT_AI_SETTINGS.enabled) as boolean,
      provider: get(state.aiSettings, 'provider', DEFAULT_AI_SETTINGS.provider) as AiSettings['provider'],
      baseUrl: get(state.aiSettings, 'baseUrl', DEFAULT_AI_SETTINGS.baseUrl) as string,
      apiKey: get(state.aiSettings, 'apiKey', DEFAULT_AI_SETTINGS.apiKey) as string,
      model: get(state.aiSettings, 'model', DEFAULT_AI_SETTINGS.model) as string,
    },
    kaikkiSource: {
      sourceUrl: get(state.kaikkiSource, 'sourceUrl', DEFAULT_SETTINGS.kaikki.sourceUrl) as string,
      sourceName: get(state.kaikkiSource, 'sourceName', DEFAULT_SETTINGS.kaikki.sourceName) as string,
    },
  };
}

function rebuildReview(node: WordNode | QuoteNode): ReviewState | undefined {
  if (!node.snapshot && Object.keys(node.reviewEvents).length === 0) return undefined;
  const log = Object.values(node.reviewEvents)
    .sort(
      (a, b) =>
        a.reviewedAt - b.reviewedAt ||
        a.eventVersion - b.eventVersion ||
        a.id.localeCompare(b.id),
    )
    .map((e) => e.payload as ReviewLogEntry);
  const base = (node.snapshot?.payload as Partial<ReviewState>) ?? {};
  return { ...(base as ReviewState), reviewLog: log };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/sync/project.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add lib/sync/project.ts tests/sync/project.test.ts
git commit -m "feat(sync): project domain to sync state and materialize back"
```

---

### Task 5: Deterministic SyncState merge

**Files:**
- Create: `lib/sync/merge.ts`
- Test: `tests/sync/merge.test.ts`

**Interfaces:**
- Consumes: `lib/sync/types`, `lib/sync/clock` (`compareTimestamps`), `lib/sync/registers` (`mergeRegister`, `mergeRegisterMap`, `mergeStampMap`).
- Produces:
  - `function mergeSyncState(a: SyncState, b: SyncState): SyncState` — commutative, associative, idempotent.
  - `function mergeWordNodes(a: WordNode, b: WordNode): WordNode`
  - `function mergeQuoteNodes(a: QuoteNode, b: QuoteNode): QuoteNode`
  - `function deleteEntity(state: SyncState, key: string, stamp: HybridTimestamp): SyncState` — adds a tombstone.

Merge rules from the spec: words merge by `word:<normalized>` key; canonical `createdAt` takes the earliest, ID tie-broken by smallest; occurrences union with element tombstones; review events union; the snapshot tied to the highest-ordered review event wins; quotes keep distinct IDs; settings merge per leaf; tombstones take max stamp and suppress lower-stamped values.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/merge.test.ts
import { describe, expect, it } from 'vitest';
import { deleteEntity, mergeSyncState } from '../../lib/sync/merge';
import { projectInbox, wordKey } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import type { Inbox, WordEntry } from '../../lib/types';

function word(over: Partial<WordEntry>): WordEntry {
  return {
    id: 'w', kind: 'word', text: '你好', normalized: '你好', note: '', status: 'inbox',
    createdAt: 10, updatedAt: 10, occurrences: [], ...over,
  };
}
const proj = (inbox: Inbox, replicaId: string, wallTime: number) =>
  projectInbox(inbox, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId, wallTime });

describe('mergeSyncState', () => {
  it('is idempotent', () => {
    const a = proj({ words: [word({})], quotes: [] }, 'A', 100);
    expect(mergeSyncState(a, a)).toEqual(a);
  });

  it('is commutative on independent words', () => {
    const a = proj({ words: [word({ id: 'a', normalized: '你好', text: '你好' })], quotes: [] }, 'A', 100);
    const b = proj({ words: [word({ id: 'b', normalized: '再见', text: '再见' })], quotes: [] }, 'B', 100);
    const ab = mergeSyncState(a, b);
    const ba = mergeSyncState(b, a);
    expect(Object.keys(ab.words).sort()).toEqual(Object.keys(ba.words).sort());
  });

  it('converges same-normalized words and unions occurrences', () => {
    const occ = (capturedAt: number) => ({ sourceTitle: 't', sourceUrl: `u${capturedAt}`, sourceDomain: 'd', surrounding: 's', capturedAt });
    const a = proj({ words: [word({ id: 'a', occurrences: [occ(1)] })], quotes: [] }, 'A', 100);
    const b = proj({ words: [word({ id: 'b', occurrences: [occ(2)] })], quotes: [] }, 'B', 100);
    const merged = mergeSyncState(a, b);
    const node = merged.words[wordKey('你好')];
    expect(Object.keys(node.occurrences)).toHaveLength(2);
    expect(node.fields.id?.value).toBe('a'); // earliest createdAt tie -> smallest id 'a'
  });

  it('suppresses a word resurrection from a stale replica', () => {
    const a = proj({ words: [word({ updatedAt: 50 })], quotes: [] }, 'A', 100);
    const deleted = deleteEntity(a, wordKey('你好'), { wallTime: 200, counter: 0, replicaId: 'A' });
    const stale = proj({ words: [word({ updatedAt: 50 })], quotes: [] }, 'B', 60);
    const merged = mergeSyncState(deleted, stale);
    expect(merged.tombstones[wordKey('你好')]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/merge.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/merge.ts
import { compareTimestamps } from './clock';
import { mergeRegister, mergeRegisterMap, mergeStampMap } from './registers';
import type {
  HybridTimestamp,
  OccurrenceNode,
  QuoteNode,
  Register,
  ReviewEventNode,
  SchedulerSnapshotNode,
  SyncState,
  WordNode,
} from './types';

function mergeOccurrences(
  a: Record<string, OccurrenceNode>,
  b: Record<string, OccurrenceNode>,
): Record<string, OccurrenceNode> {
  const out: Record<string, OccurrenceNode> = { ...a };
  for (const [id, node] of Object.entries(b)) {
    const existing = out[id];
    out[id] = !existing || compareTimestamps(node.stamp, existing.stamp) > 0 ? node : existing;
  }
  return out;
}

function mergeReviewEvents(
  a: Record<string, ReviewEventNode>,
  b: Record<string, ReviewEventNode>,
): Record<string, ReviewEventNode> {
  const out: Record<string, ReviewEventNode> = { ...a };
  for (const [id, node] of Object.entries(b)) {
    if (!out[id]) out[id] = node;
  }
  return out;
}

function reviewOrder(a: ReviewEventNode, b: ReviewEventNode): number {
  return (
    a.reviewedAt - b.reviewedAt ||
    a.eventVersion - b.eventVersion ||
    a.id.localeCompare(b.id)
  );
}

function pickSnapshot(
  events: Record<string, ReviewEventNode>,
  a?: SchedulerSnapshotNode,
  b?: SchedulerSnapshotNode,
): SchedulerSnapshotNode | undefined {
  const candidates = [a, b].filter(Boolean) as SchedulerSnapshotNode[];
  if (candidates.length === 0) return undefined;
  // Snapshot tied to the highest-ordered review event wins; tie-break by stamp.
  return candidates.sort((x, y) => {
    const ex = events[x.reviewEventId];
    const ey = events[y.reviewEventId];
    if (ex && ey) {
      const ord = reviewOrder(ex, ey);
      if (ord !== 0) return ord;
    }
    return compareTimestamps(x.stamp, y.stamp);
  })[candidates.length - 1];
}

function earliestCreatedAt(a: Register<number>, b: Register<number>): Register<number> {
  if (a.value !== b.value) return a.value < b.value ? a : b;
  return compareTimestamps(a.stamp, b.stamp) <= 0 ? a : b;
}

export function mergeWordNodes(a: WordNode, b: WordNode): WordNode {
  const events = mergeReviewEvents(a.reviewEvents, b.reviewEvents);
  const fields = mergeRegisterMap(a.fields, b.fields) as WordNode['fields'];
  const createdAt = earliestCreatedAt(a.createdAt, b.createdAt);
  // Canonical id: earliest createdAt then smallest id.
  const idA = a.fields.id?.value as string;
  const idB = b.fields.id?.value as string;
  const canonicalId =
    a.createdAt.value !== b.createdAt.value
      ? a.createdAt.value < b.createdAt.value
        ? idA
        : idB
      : idA <= idB
        ? idA
        : idB;
  fields.id = { value: canonicalId, stamp: createdAt.stamp };
  return {
    normalized: a.normalized,
    createdAt,
    fields,
    occurrences: mergeOccurrences(a.occurrences, b.occurrences),
    occurrenceTombstones: mergeStampMap(a.occurrenceTombstones, b.occurrenceTombstones),
    reviewEvents: events,
    snapshot: pickSnapshot(events, a.snapshot, b.snapshot),
  };
}

export function mergeQuoteNodes(a: QuoteNode, b: QuoteNode): QuoteNode {
  const events = mergeReviewEvents(a.reviewEvents, b.reviewEvents);
  return {
    id: a.id,
    createdAt: earliestCreatedAt(a.createdAt, b.createdAt),
    fields: mergeRegisterMap(a.fields, b.fields),
    reviewEvents: events,
    snapshot: pickSnapshot(events, a.snapshot, b.snapshot),
  };
}

function mergeNodeMap<T>(
  a: Record<string, T>,
  b: Record<string, T>,
  mergeOne: (x: T, y: T) => T,
): Record<string, T> {
  const out: Record<string, T> = { ...a };
  for (const [key, node] of Object.entries(b)) {
    out[key] = out[key] ? mergeOne(out[key], node) : node;
  }
  return out;
}

export function mergeSyncState(a: SyncState, b: SyncState): SyncState {
  return {
    replicas: Array.from(new Set([...a.replicas, ...b.replicas])).sort(),
    words: mergeNodeMap(a.words, b.words, mergeWordNodes),
    quotes: mergeNodeMap(a.quotes, b.quotes, mergeQuoteNodes),
    tombstones: mergeStampMap(a.tombstones, b.tombstones),
    appSettings: mergeRegisterMap(a.appSettings, b.appSettings),
    aiSettings: mergeRegisterMap(a.aiSettings, b.aiSettings),
    kaikkiSource: mergeRegisterMap(a.kaikkiSource, b.kaikkiSource),
  };
}

export function deleteEntity(
  state: SyncState,
  key: string,
  stamp: HybridTimestamp,
): SyncState {
  return { ...state, tombstones: mergeStampMap(state.tombstones, { [key]: stamp }) };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/merge.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add property tests for associativity and convergence**

Append to `tests/sync/merge.test.ts`:

```ts
describe('merge algebra', () => {
  const occ = (u: string) => ({ sourceTitle: 't', sourceUrl: u, sourceDomain: 'd', surrounding: 's', capturedAt: 1 });
  const a = proj({ words: [word({ id: 'a', occurrences: [occ('u1')] })], quotes: [] }, 'A', 100);
  const b = proj({ words: [word({ id: 'b', occurrences: [occ('u2')] })], quotes: [] }, 'B', 100);
  const c = proj({ words: [word({ id: 'c', normalized: '好', text: '好' })], quotes: [] }, 'C', 100);

  it('is associative', () => {
    const left = mergeSyncState(mergeSyncState(a, b), c);
    const right = mergeSyncState(a, mergeSyncState(b, c));
    expect(left).toEqual(right);
  });

  it('converges regardless of order', () => {
    const order1 = mergeSyncState(mergeSyncState(a, b), c);
    const order2 = mergeSyncState(mergeSyncState(c, a), b);
    expect(order1).toEqual(order2);
  });
});
```

Run: `npm test -- tests/sync/merge.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add lib/sync/merge.ts tests/sync/merge.test.ts
git commit -m "feat(sync): add deterministic sync state merge"
```

---

## Phase 2 — Crypto & vault

### Task 6: Crypto module (KDF + AES-GCM)

**Files:**
- Create: `lib/sync/crypto.ts`
- Test: `tests/sync/crypto.test.ts`

**Interfaces:**
- Consumes: global `crypto.subtle` (available in Vitest via `happy-dom`; `crypto.getRandomValues` and `crypto.subtle` are present in Node 20+).
- Produces:
  - `interface KdfParams { algorithm: 'PBKDF2-HMAC-SHA-256'; iterations: number; salt: string /* base64 */ }`
  - `function defaultKdfParams(): KdfParams` — 600000 iterations + fresh 128-bit salt.
  - `async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey>`
  - `async function encryptJson(key: CryptoKey, value: unknown, aad: Uint8Array): Promise<{ nonce: string; ciphertext: string }>` (base64).
  - `async function decryptJson<T>(key: CryptoKey, nonce: string, ciphertext: string, aad: Uint8Array): Promise<T>` — throws on auth failure.
  - `async function makeVerification(key: CryptoKey): Promise<{ nonce: string; ciphertext: string }>` and `async function checkVerification(key, v): Promise<boolean>` over a fixed plaintext constant `VERIFICATION_PLAINTEXT`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/crypto.test.ts
import { describe, expect, it } from 'vitest';
import {
  checkVerification,
  decryptJson,
  defaultKdfParams,
  deriveKey,
  encryptJson,
  makeVerification,
} from '../../lib/sync/crypto';

const aad = new TextEncoder().encode('shiyu-hanzi-box|1|V1|R1');

describe('crypto round trip', () => {
  it('encrypts and decrypts with the correct key', async () => {
    const params = defaultKdfParams();
    const key = await deriveKey('correct horse', params);
    const { nonce, ciphertext } = await encryptJson(key, { hello: '世界' }, aad);
    const out = await decryptJson<{ hello: string }>(key, nonce, ciphertext, aad);
    expect(out.hello).toBe('世界');
  });

  it('uses a fresh nonce so identical plaintext differs', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const a = await encryptJson(key, { x: 1 }, aad);
    const b = await encryptJson(key, { x: 1 }, aad);
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('rejects tampered AAD', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const { nonce, ciphertext } = await encryptJson(key, { x: 1 }, aad);
    const wrongAad = new TextEncoder().encode('shiyu-hanzi-box|1|V1|R2');
    await expect(decryptJson(key, nonce, ciphertext, wrongAad)).rejects.toThrow();
  });

  it('rejects the wrong passphrase via verification value', async () => {
    const params = defaultKdfParams();
    const v = await makeVerification(await deriveKey('right', params));
    expect(await checkVerification(await deriveKey('right', params), v)).toBe(true);
    expect(await checkVerification(await deriveKey('wrong', params), v)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/crypto.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/crypto.ts
export interface KdfParams {
  algorithm: 'PBKDF2-HMAC-SHA-256';
  iterations: number;
  salt: string; // base64
}

const PBKDF2_ITERATIONS = 600_000;
const VERIFICATION_PLAINTEXT = 'shiyu-hanzi-box-vault-verification-v1';
const VERIFICATION_AAD = new TextEncoder().encode('verification');

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

export function defaultKdfParams(): KdfParams {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return { algorithm: 'PBKDF2-HMAC-SHA-256', iterations: PBKDF2_ITERATIONS, salt: toBase64(salt) };
}

export async function deriveKey(passphrase: string, params: KdfParams): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: fromBase64(params.salt),
      iterations: params.iterations,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptJson(
  key: CryptoKey,
  value: unknown,
  aad: Uint8Array,
): Promise<{ nonce: string; ciphertext: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad },
    key,
    plaintext,
  );
  return { nonce: toBase64(nonce), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(
  key: CryptoKey,
  nonce: string,
  ciphertext: string,
  aad: Uint8Array,
): Promise<T> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(nonce), additionalData: aad },
    key,
    fromBase64(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
}

export async function makeVerification(
  key: CryptoKey,
): Promise<{ nonce: string; ciphertext: string }> {
  return encryptJson(key, VERIFICATION_PLAINTEXT, VERIFICATION_AAD);
}

export async function checkVerification(
  key: CryptoKey,
  v: { nonce: string; ciphertext: string },
): Promise<boolean> {
  try {
    const out = await decryptJson<string>(key, v.nonce, v.ciphertext, VERIFICATION_AAD);
    return out === VERIFICATION_PLAINTEXT;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/crypto.test.ts`
Expected: PASS (4 tests). (PBKDF2 at 600k iterations runs a few times; if the suite is slow, this is expected and acceptable.)

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/crypto.ts tests/sync/crypto.test.ts
git commit -m "feat(sync): add PBKDF2 + AES-GCM crypto with verification value"
```

---

### Task 7: Vault and replica parsing/validation

**Files:**
- Create: `lib/sync/vault.ts`
- Test: `tests/sync/vault.test.ts`

**Interfaces:**
- Consumes: `lib/sync/types` (`APP_ID`, `VAULT_FORMAT_VERSION`, `SYNC_FORMAT_VERSION`, `SyncReplica`, `SyncState`), `lib/sync/crypto` (`KdfParams`, encrypt/decrypt), `lib/sync/clock`.
- Produces:
  - `interface VaultManifest { app: typeof APP_ID; vaultFormatVersion: 1; vaultId: string; kdf: KdfParams; cipher: 'AES-256-GCM'; verification: { nonce: string; ciphertext: string } }`
  - `function isVaultManifest(value: unknown): value is VaultManifest` — strict structural validation; rejects unknown app/version.
  - `function replicaAad(vaultId: string, replicaId: string): Uint8Array` — encodes `app|formatVersion|vaultId|replicaId`.
  - `async function encryptReplica(key, replica: SyncReplica): Promise<string>` — serialized `{ header, nonce, ciphertext }` JSON; header carries app/format/vaultId/replicaId only.
  - `async function decryptReplica(key, raw: string, expected: { vaultId: string }): Promise<SyncReplica>` — validates header, AAD, format; throws typed errors `'replica-incompatible' | 'vault-invalid'`.
  - `const REPLICA_FILENAME = /^[0-9A-HJKMNP-TV-Z]{26}\.shiyu$/` (Crockford base32 ULID grammar) and `function isReplicaFilename(name: string): boolean`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/vault.test.ts
import { describe, expect, it } from 'vitest';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import {
  decryptReplica,
  encryptReplica,
  isReplicaFilename,
  isVaultManifest,
} from '../../lib/sync/vault';
import { EMPTY_SYNC_STATE, type SyncReplica } from '../../lib/sync/types';

const replica: SyncReplica = {
  app: 'shiyu-hanzi-box',
  formatVersion: 1,
  vaultId: 'V1',
  replicaId: 'R1',
  writtenAt: { wallTime: 1, counter: 0, replicaId: 'R1' },
  state: EMPTY_SYNC_STATE,
};

describe('replica filenames', () => {
  it('accepts ULID .shiyu names and rejects conflict copies', () => {
    expect(isReplicaFilename('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu')).toBe(true);
    expect(isReplicaFilename('01J0AZ5K2YJ3M4N5P6Q7R8S9TV (1).shiyu')).toBe(false);
    expect(isReplicaFilename('vault.json')).toBe(false);
  });
});

describe('replica encrypt/decrypt', () => {
  it('round-trips a replica with the right key and vault', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const raw = await encryptReplica(key, replica);
    const out = await decryptReplica(key, raw, { vaultId: 'V1' });
    expect(out.replicaId).toBe('R1');
  });

  it('rejects a replica claiming a different vault id', async () => {
    const key = await deriveKey('pw', defaultKdfParams());
    const raw = await encryptReplica(key, replica);
    await expect(decryptReplica(key, raw, { vaultId: 'OTHER' })).rejects.toThrow();
  });
});

describe('vault manifest validation', () => {
  it('rejects foreign or unversioned manifests', () => {
    expect(isVaultManifest({ app: 'other' })).toBe(false);
    expect(isVaultManifest(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/vault.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/vault.ts
import { decryptJson, encryptJson, type KdfParams } from './crypto';
import { APP_ID, SYNC_FORMAT_VERSION, VAULT_FORMAT_VERSION, type SyncReplica } from './types';

export interface VaultManifest {
  app: typeof APP_ID;
  vaultFormatVersion: 1;
  vaultId: string;
  kdf: KdfParams;
  cipher: 'AES-256-GCM';
  verification: { nonce: string; ciphertext: string };
}

export const REPLICA_FILENAME = /^[0-9A-HJKMNP-TV-Z]{26}\.shiyu$/;

export function isReplicaFilename(name: string): boolean {
  return REPLICA_FILENAME.test(name);
}

export function isVaultManifest(value: unknown): value is VaultManifest {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    v.app === APP_ID &&
    v.vaultFormatVersion === VAULT_FORMAT_VERSION &&
    typeof v.vaultId === 'string' &&
    v.cipher === 'AES-256-GCM' &&
    !!v.kdf &&
    typeof v.kdf === 'object' &&
    !!v.verification &&
    typeof v.verification === 'object'
  );
}

export function replicaAad(vaultId: string, replicaId: string): Uint8Array {
  return new TextEncoder().encode(`${APP_ID}|${SYNC_FORMAT_VERSION}|${vaultId}|${replicaId}`);
}

interface ReplicaFile {
  header: { app: typeof APP_ID; formatVersion: 1; vaultId: string; replicaId: string };
  nonce: string;
  ciphertext: string;
}

export async function encryptReplica(key: CryptoKey, replica: SyncReplica): Promise<string> {
  const aad = replicaAad(replica.vaultId, replica.replicaId);
  const { nonce, ciphertext } = await encryptJson(key, replica, aad);
  const file: ReplicaFile = {
    header: {
      app: APP_ID,
      formatVersion: SYNC_FORMAT_VERSION,
      vaultId: replica.vaultId,
      replicaId: replica.replicaId,
    },
    nonce,
    ciphertext,
  };
  return JSON.stringify(file);
}

export async function decryptReplica(
  key: CryptoKey,
  raw: string,
  expected: { vaultId: string },
): Promise<SyncReplica> {
  let file: ReplicaFile;
  try {
    file = JSON.parse(raw) as ReplicaFile;
  } catch {
    throw new Error('replica-incompatible');
  }
  if (file.header?.app !== APP_ID || file.header.formatVersion !== SYNC_FORMAT_VERSION) {
    throw new Error('replica-incompatible');
  }
  if (file.header.vaultId !== expected.vaultId) {
    throw new Error('vault-invalid');
  }
  const aad = replicaAad(file.header.vaultId, file.header.replicaId);
  const replica = await decryptJson<SyncReplica>(key, file.nonce, file.ciphertext, aad);
  if (replica.vaultId !== expected.vaultId || replica.replicaId !== file.header.replicaId) {
    throw new Error('vault-invalid');
  }
  return replica;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/vault.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/vault.ts tests/sync/vault.test.ts
git commit -m "feat(sync): add vault manifest and replica envelope parsing"
```

---

## Phase 3 — Local state & filesystem

### Task 8: Local sync config, metadata, and handle persistence

**Files:**
- Create: `lib/sync/local.ts`
- Test: `tests/sync/local.test.ts`

**Interfaces:**
- Consumes: `wxt/utils/storage` (`storage.defineItem`), `lib/sync/types`.
- Produces:
  - `interface SyncConfig { vaultId: string | null; replicaId: string; replicaLabel: string; folderName: string | null; lastSuccessAt: number | null; pending: boolean; status: SyncStatus; lastError: SyncError | null; localRevision: number }`
  - `const syncConfigStorage = storage.defineItem<SyncConfig>('local:syncConfig', { fallback })`
  - `async function getSyncConfig(): Promise<SyncConfig>`, `async function setSyncConfig(next): Promise<void>`, `async function mutateSyncConfig(fn)`.
  - `function makeReplicaId(wallTime: number, random: Uint8Array): string` — ULID (Crockford base32, 48-bit time + 80-bit random) so filenames match `REPLICA_FILENAME`.
  - `async function ensureReplicaId(): Promise<string>` — generates + persists once, preserved across updates.
  - Directory-handle persistence in IndexedDB: `async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void>`, `async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null>`, `async function clearDirectoryHandle(): Promise<void>`. (Uses a tiny IndexedDB wrapper; structured-clone stores the handle.)
  - Remembered key storage: the derived key is non-extractable, so it cannot be JSON-serialized. Persist it as a `CryptoKey` via IndexedDB structured clone: `async function rememberKey(key: CryptoKey)`, `async function recallKey(): Promise<CryptoKey | null>`, `async function forgetKey()`.

> Test note: `@webext-core/fake-browser` provides `chrome.storage.local`. IndexedDB is provided by `happy-dom`. ULID generation takes `wallTime` and random bytes as params for deterministic tests; production callers pass `Date.now()` and `crypto.getRandomValues`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/local.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getSyncConfig,
  makeReplicaId,
  mutateSyncConfig,
} from '../../lib/sync/local';
import { isReplicaFilename } from '../../lib/sync/vault';

describe('sync local config', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to disconnected', async () => {
    const cfg = await getSyncConfig();
    expect(cfg.vaultId).toBeNull();
    expect(cfg.status).toBe('disabled');
  });

  it('persists mutations', async () => {
    await mutateSyncConfig((cfg) => ({ ...cfg, replicaLabel: 'Laptop' }));
    expect((await getSyncConfig()).replicaLabel).toBe('Laptop');
  });

  it('generates ULID replica ids that match the filename grammar', () => {
    const bytes = new Uint8Array(10).fill(7);
    const id = makeReplicaId(1700000000000, bytes);
    expect(isReplicaFilename(`${id}.shiyu`)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/local.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/local.ts
import { storage } from 'wxt/utils/storage';
import type { SyncError, SyncStatus } from './types';

export interface SyncConfig {
  vaultId: string | null;
  replicaId: string;
  replicaLabel: string;
  folderName: string | null;
  lastSuccessAt: number | null;
  pending: boolean;
  status: SyncStatus;
  lastError: SyncError | null;
  localRevision: number;
}

const FALLBACK: SyncConfig = {
  vaultId: null,
  replicaId: '',
  replicaLabel: '',
  folderName: null,
  lastSuccessAt: null,
  pending: false,
  status: 'disabled',
  lastError: null,
  localRevision: 0,
};

export const syncConfigStorage = storage.defineItem<SyncConfig>('local:syncConfig', {
  fallback: FALLBACK,
});

export async function getSyncConfig(): Promise<SyncConfig> {
  return syncConfigStorage.getValue();
}

export async function setSyncConfig(next: SyncConfig): Promise<void> {
  await syncConfigStorage.setValue(next);
}

let chain: Promise<unknown> = Promise.resolve();
export async function mutateSyncConfig(
  fn: (cfg: SyncConfig) => SyncConfig,
): Promise<SyncConfig> {
  const run = chain.then(() => getSyncConfig()).then((cfg) => fn(cfg));
  chain = run.then(setSyncConfig);
  return run;
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function makeReplicaId(wallTime: number, random: Uint8Array): string {
  // 48-bit timestamp (10 chars) + 80-bit randomness (16 chars) = 26-char ULID.
  let time = '';
  let t = wallTime;
  for (let i = 9; i >= 0; i -= 1) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  let rand = '';
  let bits = 0;
  let acc = 0;
  for (const byte of random) {
    acc = (acc << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      rand += CROCKFORD[(acc >> bits) & 31];
    }
  }
  return (time + rand).slice(0, 26);
}

export async function ensureReplicaId(): Promise<string> {
  const cfg = await getSyncConfig();
  if (cfg.replicaId) return cfg.replicaId;
  const id = makeReplicaId(Date.now(), crypto.getRandomValues(new Uint8Array(10)));
  await mutateSyncConfig((c) => ({ ...c, replicaId: id }));
  return id;
}

// --- IndexedDB for non-serializable handles and CryptoKey ---

const DB_NAME = 'shiyu-sync';
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  const value = await new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as T) ?? null);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return value;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export const saveDirectoryHandle = (h: FileSystemDirectoryHandle) => idbPut('dir', h);
export const loadDirectoryHandle = () => idbGet<FileSystemDirectoryHandle>('dir');
export const clearDirectoryHandle = () => idbDelete('dir');
export const rememberKey = (k: CryptoKey) => idbPut('key', k);
export const recallKey = () => idbGet<CryptoKey>('key');
export const forgetKey = () => idbDelete('key');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/local.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/local.ts tests/sync/local.test.ts
git commit -m "feat(sync): add local sync config, ULID ids, and handle/key persistence"
```

---

### Task 9: Filesystem adapter with in-memory fake

**Files:**
- Create: `lib/sync/files.ts`
- Test: `tests/sync/files.test.ts`

**Interfaces:**
- Consumes: `FileSystemDirectoryHandle` (real); nothing extension-specific.
- Produces:
  - `interface SyncFs { listReplicas(): Promise<string[]>; readFile(name: string): Promise<string>; writeFile(name: string, contents: string): Promise<void>; readManifest(): Promise<string | null>; writeManifest(contents: string): Promise<void> }`
  - `const SYNC_DIRNAME = '拾语汉字box-sync'`, `const REPLICAS_DIRNAME = 'replicas'`, `const MANIFEST_NAME = 'vault.json'`.
  - `async function openSyncFs(parent: FileSystemDirectoryHandle): Promise<SyncFs>` — creates/opens the app subdirectory + `replicas/`, filters reads through `isReplicaFilename`, writes via `createWritable()` and only resolves after `close()`.
  - `class MemoryFs implements SyncFs` — in-memory fake for tests, plus `seed(name, contents)`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/files.test.ts
import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../../lib/sync/files';

describe('MemoryFs', () => {
  it('lists only valid replica filenames', async () => {
    const fs = new MemoryFs();
    fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', 'a');
    fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV (1).shiyu', 'conflict');
    fs.seed('notes.txt', 'x');
    expect(await fs.listReplicas()).toEqual(['01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu']);
  });

  it('round-trips writes and reads', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('01J0AZ5K2YJ3M4N5P6Q7R8S9TW.shiyu', 'payload');
    expect(await fs.readFile('01J0AZ5K2YJ3M4N5P6Q7R8S9TW.shiyu')).toBe('payload');
  });

  it('reads and writes the manifest', async () => {
    const fs = new MemoryFs();
    expect(await fs.readManifest()).toBeNull();
    await fs.writeManifest('{}');
    expect(await fs.readManifest()).toBe('{}');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/files.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/files.ts
import { isReplicaFilename } from './vault';

export const SYNC_DIRNAME = '拾语汉字box-sync';
export const REPLICAS_DIRNAME = 'replicas';
export const MANIFEST_NAME = 'vault.json';

export interface SyncFs {
  listReplicas(): Promise<string[]>;
  readFile(name: string): Promise<string>;
  writeFile(name: string, contents: string): Promise<void>;
  readManifest(): Promise<string | null>;
  writeManifest(contents: string): Promise<void>;
}

export async function openSyncFs(parent: FileSystemDirectoryHandle): Promise<SyncFs> {
  const root = await parent.getDirectoryHandle(SYNC_DIRNAME, { create: true });
  const replicas = await root.getDirectoryHandle(REPLICAS_DIRNAME, { create: true });

  async function write(dir: FileSystemDirectoryHandle, name: string, contents: string) {
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close(); // success only after close resolves
  }

  return {
    async listReplicas() {
      const names: string[] = [];
      // @ts-expect-error async iterator is part of the File System Access API
      for await (const [name, handle] of replicas.entries()) {
        if (handle.kind === 'file' && isReplicaFilename(name)) names.push(name);
      }
      return names.sort();
    },
    async readFile(name) {
      const handle = await replicas.getFileHandle(name);
      return (await handle.getFile()).text();
    },
    writeFile: (name, contents) => write(replicas, name, contents),
    async readManifest() {
      try {
        const handle = await root.getFileHandle(MANIFEST_NAME);
        return (await handle.getFile()).text();
      } catch {
        return null;
      }
    },
    writeManifest: (contents) => write(root, MANIFEST_NAME, contents),
  };
}

export class MemoryFs implements SyncFs {
  private replicas = new Map<string, string>();
  private manifest: string | null = null;

  seed(name: string, contents: string) {
    this.replicas.set(name, contents);
  }

  async listReplicas(): Promise<string[]> {
    return [...this.replicas.keys()].filter(isReplicaFilename).sort();
  }

  async readFile(name: string): Promise<string> {
    const value = this.replicas.get(name);
    if (value === undefined) throw new Error(`missing ${name}`);
    return value;
  }

  async writeFile(name: string, contents: string): Promise<void> {
    this.replicas.set(name, contents);
  }

  async readManifest(): Promise<string | null> {
    return this.manifest;
  }

  async writeManifest(contents: string): Promise<void> {
    this.manifest = contents;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/files.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/files.ts tests/sync/files.test.ts
git commit -m "feat(sync): add filesystem adapter and in-memory fake"
```

---

## Phase 4 — Mutation broker & coordinator

### Task 10: Revisioned mutation protocol and reconciliation

**Files:**
- Create: `lib/sync/mutations.ts`
- Create: `lib/sync/metadata.ts` (storage for sync metadata + last-merged digest)
- Test: `tests/sync/mutations.test.ts`

**Interfaces:**
- Consumes: `lib/storage` (`getInbox`, `setInbox`), `lib/settings`, `lib/ai/settings`, `lib/sync/local` (`mutateSyncConfig`), `lib/sync/project`, `lib/sync/types`.
- Produces:
  - `const syncMetadataStorage = storage.defineItem<SyncMetadata>('local:syncMetadata', { fallback })` where `interface SyncMetadata { revision: number; state: SyncState | null; lastDigest: string | null }`.
  - `async function applyLocalMutation(kind: 'inbox' | 'settings' | 'ai', writer: () => Promise<void>): Promise<void>` — runs the domain write, bumps a shared `localRevision` in both `SyncConfig` and `SyncMetadata`, marks pending.
  - `async function reconcileOnStartup(): Promise<void>` — if `SyncConfig.localRevision !== SyncMetadata.revision`, rebuild `SyncMetadata.state` from current domain values and keep pending.
  - `async function readDomainSnapshot(): Promise<{ inbox; settings; ai }>` and `async function writeDomainSnapshot(merged): Promise<void>` used by the coordinator.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/mutations.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { applyLocalMutation, reconcileOnStartup, syncMetadataStorage } from '../../lib/sync/mutations';
import { getSyncConfig } from '../../lib/sync/local';
import { setInbox } from '../../lib/storage';

describe('local mutation protocol', () => {
  beforeEach(() => fakeBrowser.reset());

  it('bumps a shared revision and marks pending', async () => {
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    const cfg = await getSyncConfig();
    const meta = await syncMetadataStorage.getValue();
    expect(cfg.pending).toBe(true);
    expect(cfg.localRevision).toBe(meta.revision);
    expect(cfg.localRevision).toBeGreaterThan(0);
  });

  it('reconciles mismatched revisions without dropping domain data', async () => {
    await applyLocalMutation('inbox', async () => {
      await setInbox({ words: [], quotes: [] });
    });
    // Simulate an interrupted write: metadata revision behind config.
    await syncMetadataStorage.setValue({ revision: 0, state: null, lastDigest: null });
    await reconcileOnStartup();
    const cfg = await getSyncConfig();
    const meta = await syncMetadataStorage.getValue();
    expect(meta.revision).toBe(cfg.localRevision);
    expect(meta.state).not.toBeNull();
    expect(cfg.pending).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/mutations.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the modules**

```ts
// lib/sync/mutations.ts
import { storage } from 'wxt/utils/storage';
import { getInbox } from '../storage';
import { getSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { ensureReplicaId, mutateSyncConfig } from './local';
import { projectInbox } from './project';
import type { SyncState } from './types';

export interface SyncMetadata {
  revision: number;
  state: SyncState | null;
  lastDigest: string | null;
}

export const syncMetadataStorage = storage.defineItem<SyncMetadata>('local:syncMetadata', {
  fallback: { revision: 0, state: null, lastDigest: null },
});

export async function readDomainSnapshot() {
  const [inbox, settings, ai] = await Promise.all([
    getInbox(),
    getSettings(),
    aiSettingsStorage.getValue(),
  ]);
  return { inbox, settings, ai };
}

let chain: Promise<unknown> = Promise.resolve();

export async function applyLocalMutation(
  _kind: 'inbox' | 'settings' | 'ai',
  writer: () => Promise<void>,
): Promise<void> {
  const run = chain.then(async () => {
    await writer();
    const meta = await syncMetadataStorage.getValue();
    const nextRevision = meta.revision + 1;
    await syncMetadataStorage.setValue({ ...meta, revision: nextRevision, state: null });
    await mutateSyncConfig((cfg) => ({
      ...cfg,
      localRevision: nextRevision,
      pending: cfg.vaultId ? true : cfg.pending,
      status: cfg.vaultId ? 'pending' : cfg.status,
    }));
  });
  chain = run;
  return run;
}

export async function reconcileOnStartup(): Promise<void> {
  const meta = await syncMetadataStorage.getValue();
  const cfg = await mutateSyncConfig((c) => c);
  if (meta.revision === cfg.localRevision && meta.state) return;
  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  const state = projectInbox(inbox, settings, ai, { replicaId, wallTime: Date.now() });
  await syncMetadataStorage.setValue({
    revision: cfg.localRevision,
    state,
    lastDigest: meta.lastDigest,
  });
  if (cfg.vaultId) {
    await mutateSyncConfig((c) => ({ ...c, pending: true, status: 'pending' }));
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/mutations.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/mutations.ts tests/sync/mutations.test.ts
git commit -m "feat(sync): add revisioned mutation protocol and startup reconciliation"
```

---

### Task 11: Background sole-writer broker

**Files:**
- Create: `entrypoints/background/sync-mutation-handler.ts`
- Modify: `entrypoints/background/index.ts` (register the message listener + alarms)
- Modify: `lib/storage.ts`, `lib/settings.ts`, `lib/ai/settings.ts` (route synchronized writes through the broker message when not in the background context)
- Test: `tests/sync/sync-mutation-handler.test.ts`

**Interfaces:**
- Consumes: `lib/sync/mutations` (`applyLocalMutation`), `lib/capture` semantics.
- Produces:
  - `const SYNC_MUTATION_MESSAGE = 'shiyu:sync-mutation'`
  - `interface SyncMutationRequestMessage { type: typeof SYNC_MUTATION_MESSAGE; kind: 'inbox' | 'settings' | 'ai'; payload: unknown }`
  - `function registerSyncMutationHandler(): void` — `browser.runtime.onMessage` listener that, in the background context, applies the mutation via `applyLocalMutation` (sole writer).
  - `async function requestSyncMutation(kind, payload): Promise<void>` — used by non-background contexts to ask the background to write; in the background context it calls `applyLocalMutation` directly.

> Implementation guidance: the broker funnels the actual `setInbox`/`setValue` write into the background's `applyLocalMutation`. Pages (dashboard/settings/popup) send a message rather than writing synchronized keys directly. `lib/capture.ts` keeps mutating through `mutateInbox`, but `mutateInbox` is updated to wrap its `setInbox` in `applyLocalMutation` when running in the background, and to send a broker message otherwise. Because capture already runs in the background (`capture-handler.ts`), it takes the direct path.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/sync-mutation-handler.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  registerSyncMutationHandler,
  requestSyncMutation,
} from '../../entrypoints/background/sync-mutation-handler';
import { syncMetadataStorage } from '../../lib/sync/mutations';

describe('sync mutation broker', () => {
  beforeEach(() => fakeBrowser.reset());

  it('applies a mutation and bumps the revision', async () => {
    registerSyncMutationHandler();
    await requestSyncMutation('inbox', { words: [], quotes: [] });
    expect((await syncMetadataStorage.getValue()).revision).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/sync-mutation-handler.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the broker**

```ts
// entrypoints/background/sync-mutation-handler.ts
import { applyLocalMutation } from '../../lib/sync/mutations';
import { setInbox } from '../../lib/storage';
import { replaceSettings } from '../../lib/settings';
import { aiSettingsStorage } from '../../lib/ai/settings';
import type { AiSettings, AppSettings, Inbox } from '../../lib/types';

export const SYNC_MUTATION_MESSAGE = 'shiyu:sync-mutation';

export interface SyncMutationRequestMessage {
  type: typeof SYNC_MUTATION_MESSAGE;
  kind: 'inbox' | 'settings' | 'ai';
  payload: unknown;
}

async function writeKind(kind: SyncMutationRequestMessage['kind'], payload: unknown) {
  await applyLocalMutation(kind, async () => {
    if (kind === 'inbox') await setInbox(payload as Inbox);
    else if (kind === 'settings') await replaceSettings(payload as AppSettings);
    else await aiSettingsStorage.setValue(payload as AiSettings);
  });
}

export function registerSyncMutationHandler(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as SyncMutationRequestMessage;
    if (!msg || msg.type !== SYNC_MUTATION_MESSAGE) return undefined;
    return writeKind(msg.kind, msg.payload).then(() => ({ ok: true }));
  });
}

function inBackground(): boolean {
  // Background service worker has no window/document.
  return typeof window === 'undefined';
}

export async function requestSyncMutation(
  kind: SyncMutationRequestMessage['kind'],
  payload: unknown,
): Promise<void> {
  if (inBackground()) {
    await writeKind(kind, payload);
    return;
  }
  await browser.runtime.sendMessage({ type: SYNC_MUTATION_MESSAGE, kind, payload });
}
```

- [ ] **Step 4: Register in background index**

Modify `entrypoints/background/index.ts` — add inside `defineBackground(() => { ... })`:

```ts
import { registerSyncMutationHandler } from './sync-mutation-handler';
import { reconcileOnStartup } from '../../lib/sync/mutations';
// ...
  registerSyncMutationHandler();
  void reconcileOnStartup();
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/sync/sync-mutation-handler.test.ts`
Expected: PASS (1 test). In the Vitest/`happy-dom` environment `window` is defined, so the test exercises the direct background path through the registered listener via `requestSyncMutation`'s message send to `fakeBrowser`. Confirm the listener is invoked; if `window` is defined in the test env, call `registerSyncMutationHandler()` then assert revision after `requestSyncMutation` round-trips through `fakeBrowser.runtime`.

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add entrypoints/background/sync-mutation-handler.ts entrypoints/background/index.ts tests/sync/sync-mutation-handler.test.ts
git commit -m "feat(sync): add background sole-writer mutation broker"
```

---

### Task 12: Serialized coordinator

**Files:**
- Create: `lib/sync/coordinator.ts`
- Test: `tests/sync/coordinator.test.ts`

**Interfaces:**
- Consumes: `lib/sync/files` (`SyncFs`), `lib/sync/vault`, `lib/sync/crypto`, `lib/sync/merge`, `lib/sync/project`, `lib/sync/mutations`, `lib/sync/local`, `lib/sync/types`.
- Produces:
  - `interface SyncDeps { fs: SyncFs; key: CryptoKey; vaultId: string; replicaId: string; now(): number }`
  - `async function runSyncPass(deps: SyncDeps): Promise<{ status: SyncStatus; warnings: SyncError[] }>` — the 10-step pass: read all replicas, decrypt, merge, persist merged domain via broker, encrypt, write own replica, record success unless a newer local mutation arrived (revision changed).
  - `class SyncCoordinator { trigger(reason): void; runOnce(deps): Promise<...> }` — serializes attempts; a trigger during an active pass sets a rerun flag (at most one rerun).

The pass must: skip-and-warn on a single corrupt/unhydrated replica without assuming deletion; never overwrite another replica's file; only write its own; treat the write successful only after `close()` (already enforced by `files.ts`); leave pending if `localRevision` changed mid-pass.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/coordinator.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { runSyncPass, SyncCoordinator } from '../../lib/sync/coordinator';
import { deriveKey, defaultKdfParams } from '../../lib/sync/crypto';
import { encryptReplica } from '../../lib/sync/vault';
import { projectInbox } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { getInbox } from '../../lib/storage';
import type { SyncReplica } from '../../lib/sync/types';

async function deps() {
  const key = await deriveKey('pw', defaultKdfParams());
  return { fs: new MemoryFs(), key, vaultId: 'V1', replicaId: 'R-SELF', now: () => 1000 };
}

describe('runSyncPass', () => {
  beforeEach(() => fakeBrowser.reset());

  it('merges a remote replica into local state and writes own replica', async () => {
    const d = await deps();
    const remoteState = projectInbox(
      { words: [{ id: 'r', kind: 'word', text: '远', normalized: '远', note: '', status: 'inbox', createdAt: 5, updatedAt: 5, occurrences: [] }], quotes: [] },
      DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, { replicaId: 'R-REMOTE', wallTime: 5 },
    );
    const remote: SyncReplica = { app: 'shiyu-hanzi-box', formatVersion: 1, vaultId: 'V1', replicaId: 'R-REMOTE', writtenAt: { wallTime: 5, counter: 0, replicaId: 'R-REMOTE' }, state: remoteState };
    d.fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', await encryptReplica(d.key, remote));

    const result = await runSyncPass(d);
    expect(result.status).toBe('synced');
    expect((await getInbox()).words.some((w) => w.normalized === '远')).toBe(true);
    expect((await d.fs.listReplicas()).length).toBe(2); // remote + own
  });

  it('warns and keeps pending on one corrupt replica', async () => {
    const d = await deps();
    d.fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', 'not-json');
    const result = await runSyncPass(d);
    expect(result.warnings.some((w) => w.code === 'replica-incompatible')).toBe(true);
  });
});

describe('SyncCoordinator', () => {
  it('coalesces concurrent triggers into one pass plus one rerun', async () => {
    let passes = 0;
    const coord = new SyncCoordinator(async () => {
      passes += 1;
      await Promise.resolve();
      return { status: 'synced' as const, warnings: [] };
    });
    coord.trigger('a');
    coord.trigger('b');
    coord.trigger('c');
    await coord.idle();
    expect(passes).toBeLessThanOrEqual(2);
    expect(passes).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/coordinator.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module**

```ts
// lib/sync/coordinator.ts
import { mergeSyncState } from './merge';
import { materialize, projectInbox } from './project';
import { decryptReplica, encryptReplica } from './vault';
import { setInbox } from '../storage';
import { replaceSettings, getSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { applyLocalMutation, readDomainSnapshot, syncMetadataStorage } from './mutations';
import { getSyncConfig, mutateSyncConfig } from './local';
import type { SyncError, SyncReplica, SyncState, SyncStatus } from './types';
import type { SyncFs } from './files';

export interface SyncDeps {
  fs: SyncFs;
  key: CryptoKey;
  vaultId: string;
  replicaId: string;
  now(): number;
}

export async function runSyncPass(
  deps: SyncDeps,
): Promise<{ status: SyncStatus; warnings: SyncError[] }> {
  const warnings: SyncError[] = [];
  const revisionBefore = (await getSyncConfig()).localRevision;

  // Local state -> sync state.
  const { inbox, settings, ai } = await readDomainSnapshot();
  let merged: SyncState = projectInbox(inbox, settings, ai, {
    replicaId: deps.replicaId,
    wallTime: deps.now(),
  });

  // Read + merge every readable compatible replica.
  for (const name of await deps.fs.listReplicas()) {
    try {
      const raw = await deps.fs.readFile(name);
      const replica = await decryptReplica(deps.key, raw, { vaultId: deps.vaultId });
      merged = mergeSyncState(merged, replica.state);
    } catch (err) {
      const code = (err as Error).message;
      warnings.push({
        code: code === 'vault-invalid' ? 'vault-invalid' : 'replica-incompatible',
        replica: name,
      });
    }
  }

  // Persist merged domain through the broker (sole writer).
  const out = materialize(merged);
  await applyLocalMutation('inbox', async () => {
    await setInbox(out.inbox);
    const current = await getSettings();
    await replaceSettings({
      ...current,
      uiLocale: out.portableSettings.uiLocale,
      srs: out.portableSettings.srs,
      kaikki: { ...current.kaikki, sourceUrl: out.kaikkiSource.sourceUrl, sourceName: out.kaikkiSource.sourceName },
    });
    await aiSettingsStorage.setValue(out.ai);
  });
  await syncMetadataStorage.setValue({
    ...(await syncMetadataStorage.getValue()),
    state: merged,
  });

  // Encrypt + write own replica.
  const replica: SyncReplica = {
    app: 'shiyu-hanzi-box',
    formatVersion: 1,
    vaultId: deps.vaultId,
    replicaId: deps.replicaId,
    writtenAt: { wallTime: deps.now(), counter: 0, replicaId: deps.replicaId },
    state: merged,
  };
  try {
    await deps.fs.writeFile(`${deps.replicaId}.shiyu`, await encryptReplica(deps.key, replica));
  } catch {
    await mutateSyncConfig((c) => ({ ...c, pending: true, status: 'needs-attention', lastError: { code: 'write-failure' } }));
    return { status: 'needs-attention', warnings };
  }

  // A newer local mutation during the pass keeps us pending.
  const revisionAfter = (await getSyncConfig()).localRevision;
  const stillPending = revisionAfter !== revisionBefore || warnings.length > 0;
  const status: SyncStatus = warnings.length > 0 ? 'pending' : stillPending ? 'pending' : 'synced';
  await mutateSyncConfig((c) => ({
    ...c,
    pending: stillPending,
    status,
    lastSuccessAt: warnings.length === 0 ? deps.now() : c.lastSuccessAt,
    lastError: warnings[0] ?? null,
  }));
  return { status, warnings };
}

type PassFn = () => Promise<{ status: SyncStatus; warnings: SyncError[] }>;

export class SyncCoordinator {
  private running = false;
  private rerun = false;
  private active: Promise<void> = Promise.resolve();

  constructor(private readonly pass: PassFn) {}

  trigger(_reason: string): void {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    this.active = this.loop();
  }

  private async loop(): Promise<void> {
    try {
      do {
        this.rerun = false;
        await this.pass();
      } while (this.rerun);
    } finally {
      this.running = false;
    }
  }

  idle(): Promise<void> {
    return this.active;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/coordinator.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/sync/coordinator.ts tests/sync/coordinator.test.ts
git commit -m "feat(sync): add serialized sync coordinator and pass orchestration"
```

---

### Task 13: Vault create/join orchestration + alarm triggers

**Files:**
- Create: `lib/sync/connect.ts` (create/join flows wiring crypto + vault + files + local)
- Modify: `entrypoints/background/index.ts` (alarm registration + coordinator wiring)
- Modify: `wxt.config.ts` (add `unlimitedStorage` and `alarms` permissions)
- Test: `tests/sync/connect.test.ts`

**Interfaces:**
- Produces:
  - `async function createVault(parent, passphrase, label, now): Promise<{ vaultId }>` — refuses if `vault.json` already present (directs to join), derives key, writes manifest + first replica, persists config + remembered key.
  - `async function joinVault(parent, passphrase, label, now): Promise<{ vaultId }>` — validates manifest, verifies key (`checkVerification`), merges remote then bootstraps local (remote portable settings win over unversioned local), writes own replica.
  - `async function disconnect(): Promise<void>` — clears handle, vault association, remembered key; preserves local data and folder files.
  - `const SYNC_ALARM = 'shiyu:sync'` plus `function registerSyncAlarms()` using `browser.alarms` for debounced + periodic reconciliation.

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/connect.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { createVaultOnFs, joinVaultOnFs } from '../../lib/sync/connect';

describe('vault create/join', () => {
  beforeEach(() => fakeBrowser.reset());

  it('refuses create when a vault already exists', async () => {
    const fs = new MemoryFs();
    await createVaultOnFs(fs, 'pw', 'A', 1000);
    await expect(createVaultOnFs(fs, 'pw', 'B', 2000)).rejects.toThrow('vault-exists');
  });

  it('joins with the correct passphrase and rejects the wrong one', async () => {
    const fs = new MemoryFs();
    await createVaultOnFs(fs, 'pw', 'A', 1000);
    await expect(joinVaultOnFs(fs, 'wrong', 'B', 2000)).rejects.toThrow('wrong-passphrase');
    const joined = await joinVaultOnFs(fs, 'pw', 'B', 2000);
    expect(joined.vaultId).toBeTruthy();
  });
});
```

> Note: `createVaultOnFs`/`joinVaultOnFs` take a `SyncFs` directly (so the in-memory fake can drive them). The public `createVault`/`joinVault` wrap these by calling `openSyncFs(parent)` and persisting the directory handle + remembered key.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/connect.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write the module** (core `*OnFs` functions; full code)

```ts
// lib/sync/connect.ts
import { checkVerification, defaultKdfParams, deriveKey, makeVerification } from './crypto';
import { encryptReplica, isVaultManifest, type VaultManifest } from './vault';
import { mergeSyncState } from './merge';
import { materialize, projectInbox } from './project';
import { readDomainSnapshot, applyLocalMutation, syncMetadataStorage } from './mutations';
import { ensureReplicaId, mutateSyncConfig } from './local';
import { setInbox } from '../storage';
import { getSettings, replaceSettings } from '../settings';
import { aiSettingsStorage } from '../ai/settings';
import { decryptReplica } from './vault';
import { APP_ID, VAULT_FORMAT_VERSION, type SyncReplica, type SyncState } from './types';
import type { SyncFs } from './files';

function makeVaultId(random: Uint8Array): string {
  return [...random].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function createVaultOnFs(
  fs: SyncFs,
  passphrase: string,
  label: string,
  now: number,
): Promise<{ vaultId: string }> {
  if (await fs.readManifest()) throw new Error('vault-exists');
  const kdf = defaultKdfParams();
  const key = await deriveKey(passphrase, kdf);
  const vaultId = makeVaultId(crypto.getRandomValues(new Uint8Array(16)));
  const manifest: VaultManifest = {
    app: APP_ID,
    vaultFormatVersion: VAULT_FORMAT_VERSION,
    vaultId,
    kdf,
    cipher: 'AES-256-GCM',
    verification: await makeVerification(key),
  };
  await fs.writeManifest(JSON.stringify(manifest));

  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  const state = projectInbox(inbox, settings, ai, { replicaId, wallTime: now });
  await writeOwnReplica(fs, key, vaultId, replicaId, state, now);
  await persistConnection(vaultId, label, state);
  return { vaultId };
}

export async function joinVaultOnFs(
  fs: SyncFs,
  passphrase: string,
  label: string,
  now: number,
): Promise<{ vaultId: string }> {
  const rawManifest = await fs.readManifest();
  if (!rawManifest) throw new Error('vault-invalid');
  const manifest: unknown = JSON.parse(rawManifest);
  if (!isVaultManifest(manifest)) throw new Error('vault-invalid');
  const key = await deriveKey(passphrase, manifest.kdf);
  if (!(await checkVerification(key, manifest.verification))) throw new Error('wrong-passphrase');

  // Merge remote replicas first.
  let remote: SyncState | null = null;
  for (const name of await fs.listReplicas()) {
    try {
      const replica = await decryptReplica(key, await fs.readFile(name), { vaultId: manifest.vaultId });
      remote = remote ? mergeSyncState(remote, replica.state) : replica.state;
    } catch {
      // skip unreadable replica; do not assume deletion
    }
  }

  const replicaId = await ensureReplicaId();
  const { inbox, settings, ai } = await readDomainSnapshot();
  const local = projectInbox(inbox, settings, ai, { replicaId, wallTime: now });
  // Established vault: remote portable settings win; local inbox still merges.
  const merged = remote ? mergeSyncState(remote, local) : local;

  const out = materialize(merged);
  await applyLocalMutation('inbox', async () => {
    await setInbox(out.inbox);
    const current = await getSettings();
    await replaceSettings({
      ...current,
      uiLocale: out.portableSettings.uiLocale,
      srs: out.portableSettings.srs,
      kaikki: { ...current.kaikki, sourceUrl: out.kaikkiSource.sourceUrl, sourceName: out.kaikkiSource.sourceName },
    });
    await aiSettingsStorage.setValue(out.ai);
  });
  await writeOwnReplica(fs, key, manifest.vaultId, replicaId, merged, now);
  await persistConnection(manifest.vaultId, label, merged);
  return { vaultId: manifest.vaultId };
}

async function writeOwnReplica(
  fs: SyncFs,
  key: CryptoKey,
  vaultId: string,
  replicaId: string,
  state: SyncState,
  now: number,
): Promise<void> {
  const replica: SyncReplica = {
    app: APP_ID,
    formatVersion: 1,
    vaultId,
    replicaId,
    writtenAt: { wallTime: now, counter: 0, replicaId },
    state,
  };
  await fs.writeFile(`${replicaId}.shiyu`, await encryptReplica(key, replica));
}

async function persistConnection(vaultId: string, label: string, state: SyncState): Promise<void> {
  await syncMetadataStorage.setValue({
    ...(await syncMetadataStorage.getValue()),
    state,
  });
  await mutateSyncConfig((cfg) => ({
    ...cfg,
    vaultId,
    replicaLabel: label || cfg.replicaLabel,
    status: 'synced',
    pending: false,
    lastError: null,
  }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/connect.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add permissions to `wxt.config.ts`**

Add `'unlimitedStorage'` and `'alarms'` to the manifest `permissions` array.

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add lib/sync/connect.ts tests/sync/connect.test.ts wxt.config.ts
git commit -m "feat(sync): add vault create/join orchestration and permissions"
```

---

## Phase 5 — UI, backup, and final wiring

### Task 14: i18n strings

**Files:**
- Modify: `lib/i18n.ts`
- Test: `tests/sync/i18n-sync.test.ts`

**Interfaces:**
- Produces: new string keys under a `sync.*` namespace in both `en` and `zh-CN`, covering every UI label in the spec (Folder Sync section, statuses, warnings, buttons).

- [ ] **Step 1: Read `lib/i18n.ts` to learn the existing structure**

Run: `npm test -- tests/i18n-source.test.ts` first to see the existing contract, then open `lib/i18n.ts`.

- [ ] **Step 2: Write the failing test**

```ts
// tests/sync/i18n-sync.test.ts
import { describe, expect, it } from 'vitest';
import { messages } from '../../lib/i18n';

const KEYS = [
  'sync.section.title',
  'sync.status.disabled',
  'sync.status.synced',
  'sync.status.syncing',
  'sync.status.pending',
  'sync.status.needsAttention',
  'sync.action.createVault',
  'sync.action.joinVault',
  'sync.action.syncNow',
  'sync.action.reauthorize',
  'sync.action.forgetKey',
  'sync.action.disconnect',
  'sync.warn.passphraseUnrecoverable',
  'sync.warn.includesApiKey',
  'sync.warn.localProfileSecurity',
  'sync.warn.eventualConsistency',
  'sync.warn.joinReplacesSettings',
  'sync.unsupported',
];

describe('sync i18n coverage', () => {
  it('defines every sync key in en and zh-CN', () => {
    for (const key of KEYS) {
      expect(messages.en[key], `en missing ${key}`).toBeTruthy();
      expect(messages['zh-CN'][key], `zh-CN missing ${key}`).toBeTruthy();
    }
  });
});
```

> Adjust the import (`messages`) to match the actual export shape discovered in Step 1. If `lib/i18n.ts` uses a function like `t(locale, key)`, assert via that instead.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/sync/i18n-sync.test.ts`
Expected: FAIL — keys missing.

- [ ] **Step 4: Add the strings** to both locales in `lib/i18n.ts`. Sample values:

```ts
// en
'sync.section.title': 'Folder Sync',
'sync.status.disabled': 'Off',
'sync.status.synced': 'Synced',
'sync.status.syncing': 'Syncing…',
'sync.status.pending': 'Pending',
'sync.status.needsAttention': 'Needs attention',
'sync.action.createVault': 'Create new vault',
'sync.action.joinVault': 'Join existing vault',
'sync.action.syncNow': 'Sync now',
'sync.action.reauthorize': 'Reauthorize folder',
'sync.action.forgetKey': 'Forget remembered key',
'sync.action.disconnect': 'Disconnect',
'sync.warn.passphraseUnrecoverable': 'A forgotten passphrase cannot be recovered.',
'sync.warn.includesApiKey': 'The synchronized data includes your AI API key.',
'sync.warn.localProfileSecurity': 'Remembering the key relies on the security of this browser profile.',
'sync.warn.eventualConsistency': 'Sync is eventually consistent, not instant.',
'sync.warn.joinReplacesSettings': 'Joining replaces this profile’s app and AI settings (including the API key) with the vault’s. Inbox entries are merged.',
'sync.unsupported': 'This browser does not support folder sync.',
```

Provide the Simplified Chinese equivalents for each key.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/sync/i18n-sync.test.ts`
Expected: PASS.

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add lib/i18n.ts tests/sync/i18n-sync.test.ts
git commit -m "feat(sync): add English and Simplified Chinese sync strings"
```

---

### Task 15: Full backup envelope (inbox + settings + AI)

**Files:**
- Modify: `lib/backup.ts`
- Test: `tests/sync/backup-full.test.ts`

**Interfaces:**
- Consumes: existing `lib/backup.ts` (`InboxBackup`, `createBackup`, `restoreBackup`).
- Produces:
  - `interface FullBackup { app: 'shiyu-hanzi-box'; formatVersion: 2; exportedAt: string; inbox: Inbox; settings: AppSettings; aiSettings: AiSettings }`
  - `function createFullBackup(inbox, settings, ai, exportedAt?): FullBackup`
  - `function serializeFullBackup(...): string`
  - `function restoreFullBackup(raw: string): { inbox: Inbox; settings?: AppSettings; aiSettings?: AiSettings }` — accepts v2, falls back to existing v1 inbox-only restore (leaving settings/AI untouched).

- [ ] **Step 1: Write the failing test**

```ts
// tests/sync/backup-full.test.ts
import { describe, expect, it } from 'vitest';
import { createFullBackup, restoreFullBackup, serializeFullBackup } from '../../lib/backup';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { EMPTY_INBOX } from '../../lib/types';

describe('full backup envelope', () => {
  it('round-trips inbox, settings, and AI settings', () => {
    const ai = { ...DEFAULT_AI_SETTINGS, apiKey: 'k', enabled: true };
    const raw = serializeFullBackup(EMPTY_INBOX, DEFAULT_SETTINGS, ai);
    const out = restoreFullBackup(raw);
    expect(out.aiSettings?.apiKey).toBe('k');
    expect(out.settings?.uiLocale).toBe(DEFAULT_SETTINGS.uiLocale);
  });

  it('still restores a legacy v1 inbox-only backup without touching settings', () => {
    const v1 = JSON.stringify({ formatVersion: 1, exportedAt: '2026-01-01', inbox: EMPTY_INBOX });
    const out = restoreFullBackup(v1);
    expect(out.inbox).toEqual(EMPTY_INBOX);
    expect(out.settings).toBeUndefined();
    expect(out.aiSettings).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/backup-full.test.ts`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `lib/backup.ts`** (add alongside existing exports; reuse `restoreBackup` for the v1 fallback):

```ts
import type { AiSettings, AppSettings } from './types';

export interface FullBackup {
  app: 'shiyu-hanzi-box';
  formatVersion: 2;
  exportedAt: string;
  inbox: Inbox;
  settings: AppSettings;
  aiSettings: AiSettings;
}

export function createFullBackup(
  inbox: Inbox,
  settings: AppSettings,
  aiSettings: AiSettings,
  exportedAt = new Date(),
): FullBackup {
  return {
    app: 'shiyu-hanzi-box',
    formatVersion: 2,
    exportedAt: exportedAt.toISOString(),
    inbox: cloneInbox(inbox),
    settings,
    aiSettings,
  };
}

export function serializeFullBackup(
  inbox: Inbox,
  settings: AppSettings,
  aiSettings: AiSettings,
  exportedAt = new Date(),
): string {
  return `${JSON.stringify(createFullBackup(inbox, settings, aiSettings, exportedAt), null, 2)}\n`;
}

export function restoreFullBackup(raw: string): {
  inbox: Inbox;
  settings?: AppSettings;
  aiSettings?: AiSettings;
} {
  const parsed: unknown = JSON.parse(raw);
  const value = parsed as Record<string, unknown>;
  if (value && value.formatVersion === 2) {
    return {
      inbox: cloneInbox(value.inbox as Inbox),
      settings: value.settings as AppSettings,
      aiSettings: value.aiSettings as AiSettings,
    };
  }
  // Fallback to v1 inbox-only restore; settings/AI left untouched.
  return { inbox: restoreBackup(raw) };
}
```

> If `cloneInbox` is not exported, reuse the existing internal helper or inline `JSON.parse(JSON.stringify(...))`. The restore UI must warn that the JSON file contains the AI API key and is unencrypted (string already added in Task 14).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/sync/backup-full.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Compile and commit**

```bash
npm run compile
git add lib/backup.ts tests/sync/backup-full.test.ts
git commit -m "feat(backup): add versioned full backup with settings and AI key"
```

---

### Task 16: Settings UI — Folder Sync section

**Files:**
- Create: `entrypoints/settings/FolderSync.tsx` (React component)
- Modify: `entrypoints/settings/*` (mount the component; match existing settings page structure)
- Test: `tests/sync/folder-sync-ui.test.tsx`

**Interfaces:**
- Consumes: `lib/sync/local` (`getSyncConfig`, `watch`), `lib/sync/connect` (`createVault`, `joinVault`, `disconnect`), `lib/sync/coordinator` trigger via a message to background, `lib/i18n`.
- Produces: a `FolderSync` React component rendering the states/controls from the spec: unsupported explanation, create/join, folder name, editable label, vault ID abbreviation, last success, pending indicator, status + error summary, sync now, reauthorize, forget key, disconnect; plus the four warnings and the join-replaces-settings confirmation.

- [ ] **Step 1: Open the existing settings entrypoint** to match component/styling conventions (Tailwind classes, i18n usage, how other sections mount). Mirror that structure — do not invent a new pattern.

- [ ] **Step 2: Write the failing test** (render + feature-detect + warning copy)

```tsx
// tests/sync/folder-sync-ui.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { render, screen } from '@testing-library/react';
import { FolderSync } from '../../entrypoints/settings/FolderSync';

describe('FolderSync UI', () => {
  beforeEach(() => fakeBrowser.reset());

  it('shows the unsupported message when File System Access is absent', () => {
    const original = (globalThis as Record<string, unknown>).showDirectoryPicker;
    delete (globalThis as Record<string, unknown>).showDirectoryPicker;
    render(<FolderSync />);
    expect(screen.getByText(/does not support folder sync/i)).toBeTruthy();
    (globalThis as Record<string, unknown>).showDirectoryPicker = original;
  });

  it('renders create and join actions when supported', () => {
    (globalThis as Record<string, unknown>).showDirectoryPicker = vi.fn();
    render(<FolderSync />);
    expect(screen.getByText(/Create new vault/i)).toBeTruthy();
    expect(screen.getByText(/Join existing vault/i)).toBeTruthy();
  });
});
```

> If `@testing-library/react` is not already a dev dependency, add it (`npm i -D @testing-library/react`). Check `package.json` first; if absent, prefer a lighter render assertion using the project's existing component-test approach (search `tests/` for any `.test.tsx`). If there are no component tests yet, keep this test minimal (mount + query) and rely on manual verification for richer interactions.

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/sync/folder-sync-ui.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 4: Implement `FolderSync.tsx`** following the existing settings section pattern. Feature-detect with `typeof showDirectoryPicker === 'function'`. Wire buttons to `lib/sync/connect` functions and a "Sync now" message to the background coordinator. Render all states from `SyncConfig`. The join flow shows `sync.warn.joinReplacesSettings` and requires confirmation before calling `joinVault`.

- [ ] **Step 5: Mount in the settings page** next to existing sections.

- [ ] **Step 6: Run tests and verify**

Run: `npm test -- tests/sync/folder-sync-ui.test.tsx`
Expected: PASS.

- [ ] **Step 7: Compile and commit**

```bash
npm run compile
git add entrypoints/settings tests/sync/folder-sync-ui.test.tsx
git commit -m "feat(sync): add Folder Sync settings section"
```

---

### Task 17: Dashboard sync status control + background alarm wiring

**Files:**
- Create: `entrypoints/dashboard/SyncStatusBadge.tsx`
- Modify: `entrypoints/dashboard/*` (mount in toolbar)
- Modify: `entrypoints/background/index.ts` (alarm listener runs the coordinator; trigger on storage change/debounce)
- Test: `tests/sync/sync-status-badge.test.tsx`

**Interfaces:**
- Consumes: `lib/sync/local` (`getSyncConfig`, watch), `lib/i18n`.
- Produces: a compact `SyncStatusBadge` reflecting `disabled | synced | syncing | pending | needs-attention`, quiet on routine success, linking to Folder Sync settings; background alarm handler that loads handle/key/config and runs `runSyncPass` through the coordinator, including the `needs-reauthorization` path when permission is `prompt`/`denied`.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/sync/sync-status-badge.test.tsx
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { render, screen } from '@testing-library/react';
import { SyncStatusBadge } from '../../entrypoints/dashboard/SyncStatusBadge';
import { mutateSyncConfig } from '../../lib/sync/local';

describe('SyncStatusBadge', () => {
  beforeEach(() => fakeBrowser.reset());

  it('stays quiet (no attention styling) when synced', async () => {
    await mutateSyncConfig((c) => ({ ...c, vaultId: 'V1', status: 'synced' }));
    render(<SyncStatusBadge />);
    expect(await screen.findByText(/Synced/i)).toBeTruthy();
  });

  it('shows needs-attention when status is needs-attention', async () => {
    await mutateSyncConfig((c) => ({ ...c, vaultId: 'V1', status: 'needs-attention' }));
    render(<SyncStatusBadge />);
    expect(await screen.findByText(/Needs attention/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/sync/sync-status-badge.test.tsx`
Expected: FAIL — component not found.

- [ ] **Step 3: Implement `SyncStatusBadge.tsx`**, subscribe to `syncConfigStorage.watch`, render the localized status, link to settings.

- [ ] **Step 4: Wire background alarms** in `entrypoints/background/index.ts`: register `browser.alarms` for periodic reconciliation, listen for `browser.alarms.onAlarm`, and on storage change for synchronized keys set pending + schedule a near-term alarm (debounce). The alarm handler builds `SyncDeps` from the persisted handle + recalled key + config; if the key is missing it sets `status: 'locked'`; if permission is not `granted` it sets `needs-reauthorization` and stops.

- [ ] **Step 5: Run tests and verify**

Run: `npm test -- tests/sync/sync-status-badge.test.tsx`
Expected: PASS.

- [ ] **Step 6: Compile and commit**

```bash
npm run compile
git add entrypoints/dashboard entrypoints/background/index.ts tests/sync/sync-status-badge.test.tsx
git commit -m "feat(sync): add dashboard status badge and background alarm sync"
```

---

### Task 18: Full regression, build, and manual verification

**Files:** none (verification task).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including the existing capture, settings, SRS, backup, and dictionary suites (no regressions).

- [ ] **Step 2: Type-check and build**

```bash
npm run compile
npm run build
```
Expected: clean compile; successful build.

- [ ] **Step 3: Manual two-profile verification (Chromium)**

Load the built extension in two Chrome profiles sharing one ordinary local test folder, then walk the spec's manual script:
1. Create a vault in profile A.
2. Capture and review data in A.
3. Join from profile B that has pre-existing local entries; confirm the join warning about settings replacement appears.
4. Verify merged data and settings in both profiles.
5. Make conflicting offline edits, reconnect, verify deterministic convergence.
6. Remove folder permission; verify local work stays usable and pending.
7. Restore permission; verify convergence.
8. Open a `.shiyu` file and `vault.json` in a text editor; confirm no user content or AI API key is visible in plaintext.

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test(sync): full regression and manual two-profile verification"
```

---

## Self-Review

**Spec coverage check (section → task):**
- Local working state & sync metadata → Tasks 1, 8, 10.
- Background mutation broker / sole writer → Task 11.
- Folder layout, vault.json, replica files → Tasks 7, 9, 13.
- Replica identity (ULID, stable) → Task 8.
- Synchronized representation / projection / legacy IDs → Tasks 1, 4.
- Hybrid logical timestamps → Task 2.
- Scalar fields / words / quotes / deletes / review / settings / bootstrap merge → Tasks 3, 4, 5, 13.
- Encryption (vault creation, replica encryption, remembered key/threat model) → Tasks 6, 7, 8, 13.
- Sync lifecycle (coordinator, triggers, permission, partial hydration, write/interruption) → Tasks 12, 13, 17.
- UI (settings, dashboard, localization) → Tasks 14, 16, 17.
- Backup and restore → Task 15.
- Error handling states → Tasks 1 (codes), 12, 17.
- Module boundaries → matches Task file layout exactly.
- Testing (pure, encryption, coordinator/fs, regression/manual) → Tasks 2–13 unit tests + Task 18.
- Compatibility/rollout (disabled by default, feature detection, version 1, unlimitedStorage) → Tasks 13, 16, 17.
- Acceptance criteria 1–12 → exercised by Task 18 manual script + the unit/integration suites.

**Known gaps deliberately deferred to implementer judgment (not placeholders):**
- Tasks 16–17 give component structure, exact test code, and wiring instructions rather than every line of JSX, because they must mirror the existing (unseen-in-this-plan) settings/dashboard component conventions; Step 1 of each requires reading those files first. This is the one place the plan intentionally defers to in-repo patterns, per the "follow established patterns" rule.
- The `needs-reauthorization` permission-recovery UI gesture is wired in Tasks 16/17; `queryPermission`/`requestPermission` calls live behind the user gesture on the settings page.

**Type-consistency check:** `SyncState`, `SyncReplica`, `HybridTimestamp`, `Register`, `SyncConfig`, `SyncMetadata`, `SyncFs`, `SyncDeps`, and the `*OnFs` connect functions keep identical names and shapes across all tasks that reference them. `applyLocalMutation`, `runSyncPass`, `mergeSyncState`, `projectInbox`, `materialize`, `encryptReplica`/`decryptReplica`, `deriveKey`/`encryptJson`/`decryptJson` are referenced consistently.

---

## Execution Notes

- Phases 0–2 (Tasks 1–7) are pure and have zero browser dependencies — they are the highest-value, lowest-risk tasks and should be implemented and reviewed first.
- Phases 3–4 introduce browser APIs behind adapters; the in-memory `MemoryFs` keeps the coordinator and connect flows unit-testable.
- Phase 5 is UI and final wiring; its tasks require reading the existing `entrypoints/settings` and `entrypoints/dashboard` code before writing components.
- Each phase ends at a green test suite and a clean compile, so the work can ship as five reviewable PRs if desired.
