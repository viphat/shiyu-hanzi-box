# Real SRS System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the fixed-interval review queue into a real FSRS-based spaced repetition system that schedules each saved word or quote from recall quality, memory difficulty/stability, and target retention — while staying local-first, deterministic in tests, and lazy-migrating old data.

**Architecture:** Add a pure `lib/srs.ts` domain module that wraps `ts-fsrs` and is the only place that touches the scheduler. It converts the persisted `ReviewState` to/from FSRS cards, maps UI ratings to FSRS grades, builds due queues, and lazily migrates old fixed-ladder (`fixed-v1`) state. UI components, queue building, and storage never import `ts-fsrs` directly — they call project helpers (`buildSrsQueue`, `answerReview`, `previewReview`, `postponeReview`, `migrateReviewState`). `lib/review.ts` becomes a thin compatibility re-export layer so existing call sites keep working during the transition.

**Tech Stack:** TypeScript, WXT (Chrome MV3), React 19, `ts-fsrs@^5.4.1` (FSRS-6 scheduler), Vitest.

**Key design decisions (from the spec):**
- SRS state is stored **on each entry** via the existing `review` field — no separate card table, so backup/export/restore stays simple.
- Lazy migration, not a one-time storage migration: old items migrate when displayed, reviewed, or postponed.
- Full timestamps, not start-of-day dates, because learning/relearning steps can be minutes apart. Queue membership uses `dueAt <= now`.
- Persist `learningSteps` from `ts-fsrs` and wake the dashboard at the next future due timestamp so sub-day cards survive reloads and appear on time.
- `newCardsPerDay` is enforced only for migrated-state `new` cards, never for learning/relearning/review.
- SRS settings live in `local:settings` under a new `srs` key; a normalization helper deep-merges defaults so old installs gain `srs` automatically.
- Review flow changes from "mark viewed" to **Reveal → Again/Hard/Good/Easy**.

---

## File Structure

**Creates:**
- `lib/srs.ts` — Pure SRS domain module: scheduler factory, rating/state mapping, ReviewState↔FSRS card conversion, lazy migration, queue building, answer/preview/postpone. The *only* importer of `ts-fsrs`.
- `tests/srs.test.ts` — Scheduler behavior, migration, queue, ratings, postpone.

**Modifies:**
- `package.json` + lockfile — add `ts-fsrs` dependency (already installed at `^5.4.1`; pin in Task 1).
- `lib/types.ts` — extend `ReviewState` with FSRS fields, including `learningSteps` so sub-day learning progress survives persistence; add `ReviewScheduler`, `ReviewCardState`, `ReviewRating`, `ReviewLogEntry`, `SrsSettings`; add `srs` to `AppSettings`.
- `lib/review.ts` — become a queue-only compatibility layer that re-exports the SRS queue item type and delegates `buildReviewQueue`; rating actions move to `lib/srs.ts`.
- `lib/settings.ts` — add `DEFAULT_SRS_SETTINGS`, `normalizeSettings`, and normalized read/watch/mutation wrappers.
- `lib/backup.ts` — validate new optional FSRS fields in `isReviewState`.
- `lib/markdown.ts` — optional concise review metadata line.
- `lib/i18n.ts` — add Reveal/rating/SRS-settings labels in both locales.
- `entrypoints/dashboard/components/ReviewQueue.tsx` — Reveal-then-rate flow; replace View/Skip/Later with Reveal + Again/Hard/Good/Easy + Postpone.
- `entrypoints/dashboard/App.tsx` — wire `answerReview`/`postponeReview`, SRS settings, stats.
- `entrypoints/dashboard/hooks/useSettings.ts` — normalize settings on read/watch/getValue.
- `entrypoints/popup/Popup.tsx` and `lib/dictionary-loader.ts` — replace raw settings storage reads/watches with normalized wrappers.
- `entrypoints/settings/SettingsApp.tsx` — SRS settings section (desired retention, max interval, new cards/day).
- `README.md` — describe real SRS and rating meanings.

---

## Task 1: Pin the `ts-fsrs` dependency

`ts-fsrs@5.4.1` is already installed in this worktree with a caret range. Pin the exact version so the persisted-card adapter is not silently exposed to a future incompatible scheduler API.

**Files:**
- Modify: `package.json` (`dependencies.ts-fsrs`)

- [ ] **Step 1: Verify the dependency entry exists**

Run:
```bash
node -e "console.log(require('./package.json').dependencies['ts-fsrs'])"
```
Expected output before pinning: `^5.4.1`

- [ ] **Step 2: Pin the exact scheduler version**

Run:
```bash
npm install ts-fsrs@5.4.1 --save-exact
```
Expected: `package.json` contains `"ts-fsrs": "5.4.1"` and the lockfile records version `5.4.1`.

- [ ] **Step 3: Verify the package resolves and types load**

Run:
```bash
node -e "const fs = require('fs'); console.log(fs.existsSync('node_modules/ts-fsrs/dist/index.d.ts'))"
```
Expected output: `true`

- [ ] **Step 4: Confirm the rest of the project still compiles**

Run: `npm run compile`
Expected: exits 0 (no type errors). `ts-fsrs` is not imported anywhere yet, so nothing changes.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): add ts-fsrs for FSRS scheduling"
```

---

## Task 2: Extend persisted review types

Add the FSRS-shaped fields to `ReviewState` and the new SRS settings type. All new fields are **optional** so existing entries and backups keep validating.

**Files:**
- Modify: `lib/types.ts:1-10` (`ReviewState`), `lib/types.ts:79-82` (`AppSettings`)

- [ ] **Step 1: Write a failing compile-time check test**

Create `tests/types-srs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type {
  AppSettings,
  ReviewCardState,
  ReviewLogEntry,
  ReviewRating,
  ReviewScheduler,
  ReviewState,
} from '../lib/types';

describe('SRS persisted types', () => {
  it('exposes FSRS review enums and shapes', () => {
    const scheduler: ReviewScheduler = 'fsrs-v1';
    const cardState: ReviewCardState = 'new';
    const rating: ReviewRating = 'again';

    const review: ReviewState = {
      scheduler,
      dueAt: 1,
      intervalDays: 0,
      repetitions: 0,
      lapses: 0,
      cardState,
      stability: 1,
      difficulty: 5,
      elapsedDays: 0,
      scheduledDays: 1,
      learningSteps: 1,
      retrievability: 0.9,
      reviewLog: [
        {
          reviewedAt: 1,
          rating,
          elapsedDays: 0,
          scheduledDays: 1,
          stateBefore: 'new',
          stateAfter: 'review',
          stabilityBefore: 0,
          stabilityAfter: 1,
          difficultyBefore: 5,
          difficultyAfter: 5,
        },
      ],
    };

    expect(review.scheduler).toBe('fsrs-v1');
    expect(review.reviewLog).toHaveLength(1);
  });

  it('keeps ReviewState backward compatible without FSRS fields', () => {
    const legacy: ReviewState = {
      dueAt: 1,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
    };
    expect(legacy.scheduler).toBeUndefined();
  });

  it('adds an srs block to AppSettings', () => {
    const settings: AppSettings = {
      uiLocale: 'zh-CN',
      kaikki: {
        enabled: false,
        sourceUrl: '',
        sourceName: '',
        hash: null,
        entryCount: 0,
        importedAt: null,
      },
      srs: {
        desiredRetention: 0.9,
        maximumIntervalDays: 3650,
        newCardsPerDay: 20,
        enableFuzz: true,
      },
    };
    expect(settings.srs.desiredRetention).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails (types do not exist yet)**

Run: `npx vitest run tests/types-srs.test.ts`
Expected: FAIL — TypeScript errors (`ReviewScheduler`, `ReviewCardState`, etc. not exported; `srs` does not exist on `AppSettings`).

- [ ] **Step 3: Extend `ReviewState` and add the new types**

In `lib/types.ts`, replace the existing `ReviewState` interface (lines 3-10):

```ts
export type ReviewScheduler = 'fixed-v1' | 'fsrs-v1';
export type ReviewCardState = 'new' | 'learning' | 'review' | 'relearning';
export type ReviewRating = 'again' | 'hard' | 'good' | 'easy';

export interface ReviewLogEntry {
  reviewedAt: number;
  rating: ReviewRating;
  elapsedDays: number;
  scheduledDays: number;
  stateBefore: ReviewCardState;
  stateAfter: ReviewCardState;
  stabilityBefore?: number;
  stabilityAfter?: number;
  difficultyBefore?: number;
  difficultyAfter?: number;
}

export interface ReviewState {
  scheduler?: ReviewScheduler;
  dueAt: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
  lastReviewedAt?: number;
  queueRank?: number;

  cardState?: ReviewCardState;
  stability?: number;
  difficulty?: number;
  elapsedDays?: number;
  scheduledDays?: number;
  /** Current ts-fsrs (re)learning step index. Must round-trip across sessions. */
  learningSteps?: number;
  retrievability?: number;
  reviewLog?: ReviewLogEntry[];
}
```

Note: `scheduler` is optional so existing entries without it are treated as `fixed-v1` by convention. The required base fields (`dueAt`, `intervalDays`, `repetitions`, `lapses`) stay required to keep the existing fixed-ladder invariant and the current `backup.ts` validators working.

- [ ] **Step 4: Add `SrsSettings` and extend `AppSettings`**

In `lib/types.ts`, add after `KaikkiSettings` (before `AppSettings`):

```ts
export interface SrsSettings {
  desiredRetention: number; // 0.80–0.97, default 0.9
  maximumIntervalDays: number; // default 3650
  newCardsPerDay: number; // default 20
  enableFuzz: boolean; // true in production, false in tests
}
```

Then extend `AppSettings`:

```ts
export interface AppSettings {
  uiLocale: UiLocale;
  kaikki: KaikkiSettings;
  srs: SrsSettings;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/types-srs.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts tests/types-srs.test.ts
git commit -m "feat(srs): extend ReviewState and AppSettings with FSRS fields"
```

---

## Task 3: Add SRS settings defaults and normalization

Add `DEFAULT_SRS_SETTINGS`, a `normalizeSettings` deep-merge helper, and a mutator. This fixes the spec requirement: "Existing installs already have `local:settings` without an `srs` key."

**Files:**
- Modify: `lib/settings.ts`
- Test: `tests/settings.test.ts`

- [ ] **Step 1: Write the failing tests**

Append a new `describe('SRS settings', ...)` block to `tests/settings.test.ts`:

```ts
import { DEFAULT_SRS_SETTINGS, normalizeSettings, setSrsSettings } from '../lib/settings';
import type { AppSettings } from '../lib/types';

describe('SRS settings', () => {
  it('exposes default SRS settings with desired retention 0.9', () => {
    expect(DEFAULT_SRS_SETTINGS).toEqual({
      desiredRetention: 0.9,
      maximumIntervalDays: 3650,
      newCardsPerDay: 20,
      enableFuzz: true,
    });
  });

  it('includes srs in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.srs).toEqual(DEFAULT_SRS_SETTINGS);
  });

  it('normalizes legacy settings that are missing the srs key', () => {
    const legacy = {
      uiLocale: 'en' as const,
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings;

    const normalized = normalizeSettings(legacy);

    expect(normalized.srs).toEqual(DEFAULT_SRS_SETTINGS);
    // does not mutate input
    expect((legacy as { srs?: unknown }).srs).toBeUndefined();
  });

  it('preserves user-customized srs settings during normalization', () => {
    const customized: AppSettings = {
      uiLocale: 'zh-CN',
      kaikki: DEFAULT_SETTINGS.kaikki,
      srs: {
        desiredRetention: 0.85,
        maximumIntervalDays: 1000,
        newCardsPerDay: 10,
        enableFuzz: true,
      },
    };

    expect(normalizeSettings(customized).srs).toEqual({
      desiredRetention: 0.85,
      maximumIntervalDays: 1000,
      newCardsPerDay: 10,
      enableFuzz: true,
    });
  });

  it('updates SRS settings immutably', () => {
    const next = setSrsSettings(DEFAULT_SETTINGS, {
      ...DEFAULT_SRS_SETTINGS,
      desiredRetention: 0.95,
    });
    expect(next.srs.desiredRetention).toBe(0.95);
    expect(DEFAULT_SETTINGS.srs.desiredRetention).toBe(0.9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `DEFAULT_SRS_SETTINGS`, `normalizeSettings`, `setSrsSettings` not exported.

- [ ] **Step 3: Implement the settings helpers**

In `lib/settings.ts`, update the imports and add the SRS defaults + normalization. First update the import line:

```ts
import { storage } from 'wxt/utils/storage';
import type { AppSettings, KaikkiSettings, SrsSettings, UiLocale } from './types';
```

Add after `DEFAULT_KAIKKI_SETTINGS`:

```ts
export const DEFAULT_SRS_SETTINGS: SrsSettings = {
  desiredRetention: 0.9,
  maximumIntervalDays: 3650,
  newCardsPerDay: 20,
  enableFuzz: true,
};
```

Update `DEFAULT_SETTINGS` to include `srs`:

```ts
export const DEFAULT_SETTINGS: AppSettings = {
  uiLocale: 'zh-CN',
  kaikki: DEFAULT_KAIKKI_SETTINGS,
  srs: DEFAULT_SRS_SETTINGS,
};
```

Add the normalization helper and mutator at the end of the file:

```ts
/**
 * Deep-merge stored settings with defaults so newly-added nested settings
 * (like `srs`) gain their defaults on existing installs. The storage fallback
 * only handles missing storage; it does not fill newly-added nested keys.
 */
type StoredAppSettings = Partial<Omit<AppSettings, 'kaikki' | 'srs'>> & {
  kaikki?: Partial<KaikkiSettings>;
  srs?: Partial<SrsSettings>;
};

export function normalizeSettings(value: StoredAppSettings | undefined | null): AppSettings {
  return {
    uiLocale: value?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
    kaikki: { ...DEFAULT_KAIKKI_SETTINGS, ...value?.kaikki },
    srs: { ...DEFAULT_SRS_SETTINGS, ...value?.srs },
  };
}

export function setSrsSettings(settings: AppSettings, srs: SrsSettings): AppSettings {
  return { ...settings, srs };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS (all settings tests, old and new).

- [ ] **Step 5: Commit**

```bash
git add lib/settings.ts tests/settings.test.ts
git commit -m "feat(srs): add SRS settings defaults and normalization helper"
```

---

## Task 4: Route every settings consumer through normalized accessors

WXT's storage fallback only handles an entirely missing value; it does not fill a newly-added nested `srs` key. Keep `settingsStorage` exported for backup/testing, but make application code use normalized read, watch, and mutation wrappers so the dashboard, settings page, popup, dictionary loader, and every mutation see a complete `AppSettings`.

**Files:**
- Modify: `lib/settings.ts`
- Modify: `entrypoints/dashboard/hooks/useSettings.ts`
- Modify: `entrypoints/popup/Popup.tsx`
- Modify: `lib/dictionary-loader.ts`
- Test: `tests/settings.test.ts`

- [ ] **Step 1: Write failing tests for normalized reads, watches, and mutations**

Append to `tests/settings.test.ts`:

```ts
import fakeBrowser from '@webext-core/fake-browser';
import { beforeEach, vi } from 'vitest';
import {
  getSettings,
  mutateSettings,
  settingsStorage,
  watchSettings,
} from '../lib/settings';

describe('normalized settings access', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('normalizes a partial stored object on read', async () => {
    const legacy = {
      uiLocale: 'en',
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings;
    await settingsStorage.setValue(legacy);

    const value = await getSettings();

    expect(value.uiLocale).toBe('en');
    expect(value.srs).toEqual(DEFAULT_SRS_SETTINGS);
  });

  it('normalizes watched values before notifying consumers', async () => {
    const listener = vi.fn();
    const unwatch = watchSettings(listener);

    await settingsStorage.setValue({
      uiLocale: 'en',
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings);

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ srs: DEFAULT_SRS_SETTINGS }),
      );
    });
    unwatch();
  });

  it('normalizes before mutation and persists the complete shape', async () => {
    await settingsStorage.setValue({
      uiLocale: 'zh-CN',
      kaikki: DEFAULT_SETTINGS.kaikki,
    } as unknown as AppSettings);

    await mutateSettings((current) => ({ ...current, uiLocale: 'en' }));

    expect(await settingsStorage.getValue()).toMatchObject({
      uiLocale: 'en',
      srs: DEFAULT_SRS_SETTINGS,
    });
  });
});
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `getSettings`, `watchSettings`, and `mutateSettings` do not exist.

- [ ] **Step 3: Add normalized accessors to `lib/settings.ts`**

Add after `settingsStorage`:

```ts
export async function getSettings(): Promise<AppSettings> {
  return normalizeSettings(await settingsStorage.getValue());
}

export function watchSettings(
  listener: (settings: AppSettings) => void,
): () => void {
  return settingsStorage.watch((next) => listener(normalizeSettings(next)));
}

export async function mutateSettings(
  mutate: (settings: AppSettings) => AppSettings,
): Promise<void> {
  const current = await getSettings();
  await settingsStorage.setValue(normalizeSettings(mutate(current)));
}

export async function replaceSettings(settings: AppSettings): Promise<void> {
  await settingsStorage.setValue(normalizeSettings(settings));
}
```

- [ ] **Step 4: Update `useSettings` to use only normalized accessors**

Replace `entrypoints/dashboard/hooks/useSettings.ts` with:

```ts
import { useCallback, useEffect, useState } from 'react';
import {
  DEFAULT_SETTINGS,
  getSettings,
  mutateSettings,
  replaceSettings,
  watchSettings,
} from '@/lib/settings';
import type { AppSettings } from '@/lib/types';

export function useSettings() {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    getSettings().then((value) => {
      if (mounted) {
        setSettings(value);
        setLoading(false);
      }
    });
    const unwatch = watchSettings((next) => {
      if (mounted) setSettings(next);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  const mutate = useCallback(
    async (fn: (settings: AppSettings) => AppSettings) => mutateSettings(fn),
    [],
  );

  const replace = useCallback(
    async (next: AppSettings) => replaceSettings(next),
    [],
  );

  return { settings, loading, mutate, replace };
}
```

- [ ] **Step 5: Replace the remaining raw application reads**

In `entrypoints/popup/Popup.tsx`, replace the `settingsStorage` import with:

```ts
import { getSettings, watchSettings } from '@/lib/settings';
```

Replace the settings effect with:

```ts
  useEffect(() => {
    let mounted = true;
    getSettings().then((settings) => {
      if (mounted) setLocale(settings.uiLocale);
    });
    const unwatch = watchSettings((settings) => {
      if (mounted) setLocale(settings.uiLocale);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);
```

In `lib/dictionary-loader.ts`, replace the `settingsStorage` import with `getSettings`, then replace:

```ts
  const settings = await settingsStorage.getValue();
```

with:

```ts
  const settings = await getSettings();
```

- [ ] **Step 6: Run focused tests and compile**

Run:
```bash
npx vitest run tests/settings.test.ts tests/dictionary-loader.test.ts
npm run compile
```
Expected: both focused test files pass and TypeScript exits 0.

- [ ] **Step 7: Commit**

```bash
git add lib/settings.ts lib/dictionary-loader.ts entrypoints/dashboard/hooks/useSettings.ts entrypoints/popup/Popup.tsx tests/settings.test.ts
git commit -m "feat(srs): normalize all settings reads, watches, and mutations"
```

---

## Task 5: Build the SRS domain module (`lib/srs.ts`) — scheduler + migration

This is the core task. Create the pure module that wraps `ts-fsrs`, converts `ReviewState`↔FSRS card, and lazily migrates old state. It is the **only** file that imports `ts-fsrs`.

This task covers: scheduler factory, rating mapping, card conversion, lazy migration, and the `migrateReviewState` helper. Answer/preview/postpone/queue come in Tasks 6–7.

**Files:**
- Create: `lib/srs.ts`
- Create: `tests/srs.test.ts`

- [ ] **Step 1: Write failing tests for migration and scheduler construction**

Create `tests/srs.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SRS_SETTINGS,
  createSrsScheduler,
  migrateReviewState,
  toFsrsCard,
  RATING_TO_GRADE,
} from '../lib/srs';
import type { WordEntry } from '../lib/types';
import type { SrsSettings } from '../lib/types';

const NOW = new Date('2026-06-24T10:30:00').getTime();
const YESTERDAY = new Date('2026-06-23T08:00:00').getTime();

const NO_FUZZ: SrsSettings = { ...DEFAULT_SRS_SETTINGS, enableFuzz: false };

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    kind: 'word',
    text: '山水',
    normalized: '山水',
    note: '',
    status: 'inbox',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    occurrences: [],
    ...overrides,
  };
}

describe('createSrsScheduler', () => {
  it('builds an FSRS scheduler from SRS settings', () => {
    const scheduler = createSrsScheduler(NO_FUZZ);
    const params = scheduler.parameters;
    expect(params.request_retention).toBe(0.9);
    expect(params.maximum_interval).toBe(3650);
    expect(params.enable_fuzz).toBe(false);
  });

  it('honors a custom desired retention and max interval', () => {
    const scheduler = createSrsScheduler({
      ...NO_FUZZ,
      desiredRetention: 0.85,
      maximumIntervalDays: 1000,
    });
    expect(scheduler.parameters.request_retention).toBe(0.85);
    expect(scheduler.parameters.maximum_interval).toBe(1000);
  });
});

describe('RATING_TO_GRADE', () => {
  it('maps UI ratings to FSRS grades excluding Manual', () => {
    expect(RATING_TO_GRADE.again).toBe(1);
    expect(RATING_TO_GRADE.hard).toBe(2);
    expect(RATING_TO_GRADE.good).toBe(3);
    expect(RATING_TO_GRADE.easy).toBe(4);
  });
});

describe('migrateReviewState', () => {
  it('initializes an entry with no review as an FSRS new card due at createdAt', () => {
    const entry = word();
    const migrated = migrateReviewState(entry, NOW);

    expect(migrated.review?.scheduler).toBe('fsrs-v1');
    expect(migrated.review?.cardState).toBe('new');
    expect(migrated.review?.dueAt).toBe(YESTERDAY);
    expect(migrated.review?.repetitions).toBe(0);
    expect(migrated.review?.lapses).toBe(0);
    expect(migrated.review?.learningSteps).toBe(0);
    expect(migrated.review?.stability).toBeUndefined();
    expect(migrated.review?.difficulty).toBeUndefined();
  });

  it('leaves an already-fsrs entry unchanged (idempotent)', () => {
    const entry = word({
      review: {
        scheduler: 'fsrs-v1',
        dueAt: NOW,
        intervalDays: 3,
        repetitions: 2,
        lapses: 0,
        cardState: 'review',
        stability: 5,
        difficulty: 5,
      },
    });
    const migrated = migrateReviewState(entry, NOW);
    expect(migrated.review).toEqual(entry.review);
  });

  it('migrates an old fixed-ladder review into an FSRS review card preserving the due date', () => {
    const entry = word({
      review: {
        dueAt: NOW,
        intervalDays: 7,
        repetitions: 3,
        lapses: 1,
        lastReviewedAt: YESTERDAY,
      },
    });
    const migrated = migrateReviewState(entry, NOW);

    expect(migrated.review?.scheduler).toBe('fsrs-v1');
    expect(migrated.review?.cardState).toBe('review');
    expect(migrated.review?.dueAt).toBe(NOW);
    expect(migrated.review?.repetitions).toBe(3);
    expect(migrated.review?.lapses).toBe(1);
    expect(migrated.review?.lastReviewedAt).toBe(YESTERDAY);
    // stability approximated from interval; difficulty approximated from lapses
    expect(migrated.review?.stability).toBe(7);
    expect(migrated.review?.difficulty).toBeCloseTo(5.5, 5);
  });

  it('migrates a fixed-ladder review with zero repetitions as a new card', () => {
    const entry = word({
      review: { dueAt: NOW, intervalDays: 0, repetitions: 0, lapses: 0 },
    });
    const migrated = migrateReviewState(entry, NOW);
    expect(migrated.review?.cardState).toBe('new');
  });
});

describe('toFsrsCard', () => {
  it('converts a migrated FSRS review state into an FSRS card', () => {
    const entry = migrateReviewState(
      word({
        review: {
          dueAt: NOW,
          intervalDays: 7,
          repetitions: 3,
          lapses: 1,
          lastReviewedAt: YESTERDAY,
        },
      }),
      NOW,
    );
    const card = toFsrsCard(entry.review!);
    expect(card.state).toBe(2); // State.Review
    expect(card.stability).toBe(7);
    expect(card.reps).toBe(3);
    expect(card.lapses).toBe(1);
    expect(card.learning_steps).toBe(0);
    expect(card.due.getTime()).toBe(NOW);
    expect(card.last_review?.getTime()).toBe(YESTERDAY);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/srs.test.ts`
Expected: FAIL — `lib/srs.ts` does not exist / exports missing.

- [ ] **Step 3: Implement `lib/srs.ts` (scheduler, mapping, conversion, migration)**

Create `lib/srs.ts`:

```ts
import { fsrs, type FSRS, type Card, type Grade, Rating, State } from 'ts-fsrs';
import type { Entry, ReviewCardState, ReviewRating, ReviewState, SrsSettings } from './types';

export { DEFAULT_SRS_SETTINGS } from './settings';

/** UI rating → FSRS grade (1=Again, 2=Hard, 3=Good, 4=Easy). Manual (0) excluded. */
export const RATING_TO_GRADE: Record<ReviewRating, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
};

const CARD_STATE_TO_FSRS: Record<ReviewCardState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
};

const FSRS_TO_CARD_STATE: Record<number, ReviewCardState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning',
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Single source of truth for FSRS scheduler parameters. Tests pass settings
 * with fuzz disabled instead of reaching into ts-fsrs directly.
 */
export function createSrsScheduler(settings: SrsSettings): FSRS {
  return fsrs({
    request_retention: settings.desiredRetention,
    maximum_interval: settings.maximumIntervalDays,
    enable_fuzz: settings.enableFuzz,
  });
}

/** Build a base ReviewState for a brand-new entry (no prior review). */
function newReviewState(createdAt: number): ReviewState {
  return {
    scheduler: 'fsrs-v1',
    cardState: 'new',
    dueAt: createdAt,
    intervalDays: 0,
    repetitions: 0,
    lapses: 0,
    learningSteps: 0,
  };
}

/**
 * Lazily migrate a persisted entry's review state to FSRS. Pure: returns a new
 * entry; does not mutate. Idempotent for already-migrated entries.
 *
 * Migration rules (per spec):
 * - No review → FSRS new card due at createdAt.
 * - Already fsrs-v1 → unchanged.
 * - Old fixed-ladder with repetitions > 0 → review card, stability≈interval,
 *   difficulty≈clamp(5 + lapses*0.5, 1, 10), due/reps/lapses/lastReviewedAt copied.
 * - Old fixed-ladder with repetitions === 0 → new card, dueAt preserved.
 */
export function migrateReviewState<T extends Entry>(entry: T, _now = Date.now()): T {
  const review = entry.review;
  if (review?.scheduler === 'fsrs-v1') return entry;

  if (!review) {
    return { ...entry, review: newReviewState(entry.createdAt) };
  }

  const repetitions = review.repetitions ?? 0;
  const lapses = review.lapses ?? 0;

  if (repetitions > 0) {
    const interval = review.intervalDays || 1;
    const difficulty = Math.min(10, Math.max(1, 5 + lapses * 0.5));
    return {
      ...entry,
      review: {
        scheduler: 'fsrs-v1',
        cardState: 'review',
        dueAt: review.dueAt,
        intervalDays: review.intervalDays,
        repetitions,
        lapses,
        lastReviewedAt: review.lastReviewedAt,
        stability: Math.max(1, interval),
        difficulty,
        learningSteps: 0,
      },
    };
  }

  return {
    ...entry,
    review: {
      scheduler: 'fsrs-v1',
      cardState: 'new',
      dueAt: review.dueAt,
      intervalDays: 0,
      repetitions: 0,
      lapses,
      learningSteps: 0,
    },
  };
}

/** Convert a persisted FSRS ReviewState into a ts-fsrs Card. */
export function toFsrsCard(review: ReviewState): Card {
  const state = review.cardState ? CARD_STATE_TO_FSRS[review.cardState] : State.New;
  const due = new Date(review.dueAt);
  return {
    due,
    stability: review.stability ?? 0,
    difficulty: review.difficulty ?? 0,
    elapsed_days: review.elapsedDays ?? 0,
    scheduled_days: review.scheduledDays ?? 0,
    learning_steps: review.learningSteps ?? 0,
    reps: review.repetitions,
    lapses: review.lapses,
    state,
    last_review: review.lastReviewedAt != null ? new Date(review.lastReviewedAt) : undefined,
  };
}

/** Convert a ts-fsrs Card + log back into a persisted ReviewState fragment. */
export function fromFsrsResult(
  card: Card,
  base: ReviewState,
  now: number,
): ReviewState {
  return {
    scheduler: 'fsrs-v1',
    cardState: FSRS_TO_CARD_STATE[card.state],
    dueAt: card.due.getTime(),
    intervalDays: card.scheduled_days,
    repetitions: card.reps,
    lapses: card.lapses,
    lastReviewedAt: now,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps,
    // Rank only results that remain due immediately. Future minute-scale
    // learning steps stay out of the queue until the wake timer reaches dueAt.
    queueRank: card.due.getTime() <= now ? now : undefined,
    reviewLog: base.reviewLog,
  };
}

export function toReviewLogEntry(
  review: ReviewState,
  card: Card,
  rating: ReviewRating,
  now: number,
): NonNullable<ReviewState['reviewLog']>[number] {
  const previous = review.reviewLog?.length
    ? review.reviewLog[review.reviewLog.length - 1]
    : undefined;
  const stabilityBefore = previous?.stabilityAfter ?? review.stability;
  const difficultyBefore = previous?.difficultyAfter ?? review.difficulty;
  return {
    reviewedAt: now,
    rating,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    stateBefore: review.cardState ?? 'new',
    stateAfter: FSRS_TO_CARD_STATE[card.state],
    stabilityBefore,
    stabilityAfter: card.stability,
    difficultyBefore,
    difficultyAfter: card.difficulty,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/srs.test.ts`
Expected: PASS (all tests in the describe blocks added so far).

- [ ] **Step 5: Commit**

```bash
git add lib/srs.ts tests/srs.test.ts
git commit -m "feat(srs): add FSRS scheduler factory, card conversion, and lazy migration"
```

---

## Task 6: Add `answerReview`, `previewReview`, `postponeReview`

Add the action helpers: rating a review, previewing the four outcomes, and postponing without altering memory.

**Files:**
- Modify: `lib/srs.ts` (append helpers)
- Modify: `tests/srs.test.ts` (append tests)

- [ ] **Step 1: Write failing tests for the three actions**

Append to `tests/srs.test.ts`:

```ts
import {
  answerReview,
  previewReview,
  postponeReview,
} from '../lib/srs';

describe('answerReview', () => {
  it('schedules different intervals for Again, Hard, Good, and Easy', () => {
    const base = migrateReviewState(word(), NOW);
    const again = answerReview(base, 'again', NOW, NO_FUZZ);
    const hard = answerReview(base, 'hard', NOW, NO_FUZZ);
    const good = answerReview(base, 'good', NOW, NO_FUZZ);
    const easy = answerReview(base, 'easy', NOW, NO_FUZZ);

    const due = (r: WordEntry) => r.review?.dueAt ?? 0;
    expect(due(again)).toBeLessThanOrEqual(due(hard));
    expect(due(hard)).toBeLessThan(due(good));
    expect(due(good)).toBeLessThan(due(easy));
  });

  it('persists card state, stability, difficulty, interval, and review log', () => {
    const base = migrateReviewState(word(), NOW);
    const next = answerReview(base, 'good', NOW, NO_FUZZ);
    const r = next.review!;
    expect(r.scheduler).toBe('fsrs-v1');
    expect(r.cardState).toBeDefined();
    expect(r.stability).toBeGreaterThan(0);
    expect(r.difficulty).toBeGreaterThanOrEqual(1);
    expect(r.dueAt).toBeGreaterThan(NOW);
    expect(r.learningSteps).toBe(1);
    expect(r.lastReviewedAt).toBe(NOW);
    expect(r.reviewLog).toHaveLength(1);
    expect(r.reviewLog![0].rating).toBe('good');
    expect(r.reviewLog![0].stateBefore).toBe('new');
  });

  it('is deterministic with fuzz disabled', () => {
    const base = migrateReviewState(word(), NOW);
    const a = answerReview(base, 'good', NOW, NO_FUZZ);
    const b = answerReview(base, 'good', NOW, NO_FUZZ);
    expect(a.review?.dueAt).toBe(b.review?.dueAt);
    expect(a.review?.stability).toBe(b.review?.stability);
  });

  it('round-trips learning step progress so the next Good graduates the card', () => {
    const first = answerReview(migrateReviewState(word(), NOW), 'good', NOW, NO_FUZZ);
    expect(first.review).toMatchObject({
      cardState: 'learning',
      learningSteps: 1,
    });

    const secondNow = first.review!.dueAt;
    const second = answerReview(first, 'good', secondNow, NO_FUZZ);

    expect(second.review).toMatchObject({
      cardState: 'review',
      learningSteps: 0,
    });
    expect(second.review!.dueAt).toBeGreaterThan(secondNow);
  });

  it('migrates an old fixed-ladder entry before answering', () => {
    const entry = word({
      review: { dueAt: NOW, intervalDays: 7, repetitions: 3, lapses: 0, lastReviewedAt: YESTERDAY },
    });
    const next = answerReview(entry, 'good', NOW, NO_FUZZ);
    expect(next.review?.scheduler).toBe('fsrs-v1');
    expect(next.review?.reviewLog).toHaveLength(1);
    expect(next.review?.reviewLog![0].stateBefore).toBe('review');
  });

  it('Again re-shows the card sooner than Good', () => {
    const base = migrateReviewState(word(), NOW);
    const good = answerReview(base, 'good', NOW, NO_FUZZ);
    const again = answerReview(base, 'again', NOW, NO_FUZZ);
    // "Again" always reschedules to at-or-before "Good"
    expect(again.review!.dueAt).toBeLessThanOrEqual(good.review!.dueAt);
  });

  it('Answering Again on a settled review card increments lapses', () => {
    // Seed a long-term review card (repetitions > 0, review state) so Again is a lapse.
    const settled = migrateReviewState(
      word({
        review: {
          scheduler: 'fsrs-v1',
          dueAt: NOW - 1,
          intervalDays: 14,
          repetitions: 4,
          lapses: 0,
          cardState: 'review',
          stability: 14,
          difficulty: 5,
          lastReviewedAt: NOW - 14 * DAY_MS,
        },
      }),
      NOW,
    );
    const before = settled.review!.lapses;
    const forgot = answerReview(settled, 'again', NOW, NO_FUZZ);
    expect(forgot.review!.lapses).toBeGreaterThan(before);
    expect(['learning', 'relearning', 'review']).toContain(forgot.review?.cardState);
  });
});

describe('previewReview', () => {
  it('returns a preview entry for each of the four ratings', () => {
    const base = migrateReviewState(word(), NOW);
    const preview = previewReview(base, NOW, NO_FUZZ);
    expect(Object.keys(preview).sort()).toEqual(['again', 'easy', 'good', 'hard']);
    expect(preview.good.dueAt).toBeGreaterThan(preview.again.dueAt);
  });
});

describe('postponeReview', () => {
  it('changes the due date without changing memory state or adding a log', () => {
    const base = answerReview(migrateReviewState(word(), NOW), 'good', NOW, NO_FUZZ);
    const before = { ...base.review! };
    const postponed = postponeReview(base, NOW, NOW + 5 * DAY_MS);
    const after = postponed.review!;

    expect(after.dueAt).toBe(NOW + 5 * DAY_MS);
    expect(after.scheduler).toBe('fsrs-v1');
    expect(after.stability).toBe(before.stability);
    expect(after.difficulty).toBe(before.difficulty);
    expect(after.repetitions).toBe(before.repetitions);
    expect(after.lapses).toBe(before.lapses);
    expect(after.cardState).toBe(before.cardState);
    expect(after.scheduledDays).toBe(5);
    expect(after.reviewLog).toBe(before.reviewLog); // unchanged reference, no new entry
    expect(after.queueRank).toBeUndefined();
    expect(postponed.updatedAt).toBe(NOW);
  });

  it('migrates and persists a never-reviewed entry as an fsrs new card on postpone', () => {
    const entry = word(); // no review
    const postponed = postponeReview(entry, NOW, NOW + DAY_MS);
    const r = postponed.review!;
    expect(r.scheduler).toBe('fsrs-v1');
    expect(r.cardState).toBe('new');
    expect(r.repetitions).toBe(0);
    expect(r.lapses).toBe(0);
    expect(r.stability).toBeUndefined();
    expect(r.dueAt).toBe(NOW + DAY_MS);
    expect(r.scheduledDays).toBe(1);
    expect(r.reviewLog).toBeUndefined();
    expect(postponed.status).toBe('inbox');
  });

  it('migrates a fixed-ladder entry before postponing', () => {
    const entry = word({
      review: { dueAt: NOW, intervalDays: 7, repetitions: 3, lapses: 0, lastReviewedAt: YESTERDAY },
    });
    const postponed = postponeReview(entry, NOW, NOW + DAY_MS);
    expect(postponed.review?.scheduler).toBe('fsrs-v1');
    expect(postponed.review?.cardState).toBe('review');
    expect(postponed.review?.stability).toBe(7);
  });
});
```

Add this constant immediately after `YESTERDAY` in `tests/srs.test.ts`:

```ts
const DAY_MS = 24 * 60 * 60 * 1000;
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/srs.test.ts`
Expected: FAIL — `answerReview`, `previewReview`, `postponeReview` not exported.

- [ ] **Step 3: Implement the three action helpers**

Append to `lib/srs.ts`:

```ts
import type { ReviewLogEntry } from './types';
```
(Merge this into the existing type import at the top of the file rather than adding a duplicate line.)

```ts
/** Preview type: each rating → the resulting card state + due date. */
export interface SrsPreviewItem {
  cardState: ReviewCardState;
  dueAt: number;
  intervalDays: number;
}
export type SrsPreview = Record<ReviewRating, SrsPreviewItem>;

const RATING_KEYS: ReviewRating[] = ['again', 'hard', 'good', 'easy'];

function appendLog(
  review: ReviewState,
  entry: ReviewLogEntry,
): ReviewLogEntry[] {
  const next = review.reviewLog ? [...review.reviewLog] : [];
  next.push(entry);
  return next;
}

/** Apply a rating and return the next persisted entry. Lazy-migrates first. */
export function answerReview<T extends Entry>(
  entry: T,
  rating: ReviewRating,
  now: number,
  settings: SrsSettings,
): T {
  const migrated = migrateReviewState(entry, now);
  const review = migrated.review!;
  const scheduler = createSrsScheduler(settings);
  const card = toFsrsCard(review);
  const grade = RATING_TO_GRADE[rating];
  const result = scheduler.next(card, now, grade);
  const log = toReviewLogEntry(review, result.card, rating, now);
  const nextReview = fromFsrsResult(result.card, review, now);
  return {
    ...migrated,
    status: migrated.status === 'archived' ? 'archived' : 'reviewed',
    updatedAt: now,
    review: {
      ...nextReview,
      reviewLog: appendLog(review, log),
    },
  };
}

/** Preview the four rating outcomes without mutating. */
export function previewReview(
  entry: Entry,
  now: number,
  settings: SrsSettings,
): SrsPreview {
  const migrated = migrateReviewState(entry, now);
  const scheduler = createSrsScheduler(settings);
  const preview = scheduler.repeat(toFsrsCard(migrated.review!), now);
  const result: Partial<SrsPreview> = {};
  for (const key of RATING_KEYS) {
    const item = preview[RATING_TO_GRADE[key]];
    result[key] = {
      cardState: FSRS_TO_CARD_STATE[item.card.state],
      dueAt: item.card.due.getTime(),
      intervalDays: item.card.scheduled_days,
    };
  }
  return result as SrsPreview;
}

/**
 * Postpone a card by setting a new dueAt without touching memory state and
 * without appending a review log entry. Lazy-migrates first.
 */
export function postponeReview<T extends Entry>(
  entry: T,
  now: number,
  dueAt: number,
): T {
  const migrated = migrateReviewState(entry, now);
  const review = migrated.review!;
  return {
    ...migrated,
    updatedAt: now,
    review: {
      ...review,
      dueAt,
      scheduledDays: Math.max(0, Math.ceil((dueAt - now) / DAY_MS)),
      queueRank: undefined,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/srs.test.ts`
Expected: PASS (all scheduler/migration/action tests).

- [ ] **Step 5: Commit**

```bash
git add lib/srs.ts tests/srs.test.ts
git commit -m "feat(srs): add answerReview, previewReview, postponeReview helpers"
```

---

## Task 7: Add `buildSrsQueue` with `dueAt <= now` and `newCardsPerDay` cap

Build the due queue using full timestamps (not end-of-day), enforce the new-card cap only on `new` cards, and sort learning/relearning ahead of review. This replaces the queue-building behavior of `lib/review.ts`.

**Files:**
- Modify: `lib/srs.ts` (append queue builder + stats)
- Modify: `tests/srs.test.ts` (append queue tests)

- [ ] **Step 1: Write failing tests for the queue**

Append to `tests/srs.test.ts`:

```ts
import {
  buildSrsQueue,
  getNextSrsWakeAt,
  getSrsStats,
  type SrsQueueItem,
} from '../lib/srs';
import type { Inbox } from '../lib/types';

describe('buildSrsQueue', () => {
  it('includes items with dueAt <= now, not end-of-day', () => {
    const laterToday = NOW + 3 * 60 * 60 * 1000; // later today, but > now
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'due-now', review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: NOW - 1, intervalDays: 3, repetitions: 2, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: YESTERDAY } })),
        migrateReviewState(word({ id: 'due-later-today', review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: laterToday, intervalDays: 3, repetitions: 2, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: YESTERDAY } })),
      ],
      quotes: [],
    };

    const ids = buildSrsQueue(inbox, NOW, NO_FUZZ).map((i) => i.entry.id);
    expect(ids).toEqual(['due-now']);
  });

  it('excludes archived entries', () => {
    const inbox: Inbox = {
      words: [migrateReviewState(word({ id: 'a', status: 'archived' }))],
      quotes: [],
    };
    expect(buildSrsQueue(inbox, NOW, NO_FUZZ)).toHaveLength(0);
  });

  it('sorts learning/relearning before long-term review', () => {
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'review-card', review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: NOW - 100, intervalDays: 3, repetitions: 2, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: YESTERDAY } })),
        migrateReviewState(word({ id: 'learning-card', review: { scheduler: 'fsrs-v1', cardState: 'learning', dueAt: NOW - 50, intervalDays: 0, repetitions: 0, lapses: 0, stability: 0.1, difficulty: 5, lastReviewedAt: NOW - 60_000 } })),
      ],
      quotes: [],
    };
    const ids = buildSrsQueue(inbox, NOW, NO_FUZZ).map((i) => i.entry.id);
    expect(ids).toEqual(['learning-card', 'review-card']);
  });

  it('caps new cards per day but never learning, relearning, or review cards', () => {
    const newWord = (id: string) => migrateReviewState(word({ id }));
    const reviewWord = (id: string) =>
      migrateReviewState(word({ id, review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: NOW - 1, intervalDays: 3, repetitions: 2, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: YESTERDAY } }));

    const settings = { ...NO_FUZZ, newCardsPerDay: 1 };
    const inbox: Inbox = {
      words: [newWord('new1'), newWord('new2'), reviewWord('rev1')],
      quotes: [],
    };

    const ids = buildSrsQueue(inbox, NOW, settings).map((i) => i.entry.id);
    expect(ids).toContain('rev1');
    expect(ids.filter((id) => id.startsWith('new'))).toHaveLength(1);
  });

  it('does not mutate new cards hidden by the cap', () => {
    const newWord = (id: string) => migrateReviewState(word({ id }));
    const settings = { ...NO_FUZZ, newCardsPerDay: 0 };
    const inbox: Inbox = { words: [newWord('new1')], quotes: [] };
    const after = buildSrsQueue(inbox, NOW, settings);
    expect(after).toHaveLength(0);
    // the source entry is untouched
    expect(inbox.words[0].review?.cardState).toBe('new');
  });
});

describe('getSrsStats', () => {
  it('counts due now, due later today, new available today, and reviewed today', () => {
    const laterToday = NOW + 3 * 60 * 60 * 1000;
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'due', review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: NOW - 1, intervalDays: 3, repetitions: 2, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: YESTERDAY } })),
        migrateReviewState(word({ id: 'later', review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: laterToday, intervalDays: 3, repetitions: 2, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: YESTERDAY } })),
      ],
      quotes: [],
    };
    const dueNow = buildSrsQueue(inbox, NOW, NO_FUZZ).length;
    const stats = getSrsStats(inbox, NOW, NO_FUZZ, dueNow);
    expect(stats.dueNow).toBe(1);
    expect(stats.dueLaterToday).toBe(1);
    expect(stats.newAvailableToday).toBe(0); // no new cards in inbox
  });

  it('counts reviewed today from review logs on the current local day', () => {
    const startOfToday = new Date(new Date(NOW).getFullYear(), new Date(NOW).getMonth(), new Date(NOW).getDate()).getTime();
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'reviewed-today', review: { scheduler: 'fsrs-v1', cardState: 'review', dueAt: NOW + DAY_MS, intervalDays: 3, repetitions: 1, lapses: 0, stability: 3, difficulty: 5, lastReviewedAt: NOW, reviewLog: [{ reviewedAt: startOfToday + 60_000, rating: 'good', elapsedDays: 0, scheduledDays: 3, stateBefore: 'new', stateAfter: 'review' }] } })),
      ],
      quotes: [],
    };
    const dueNow = buildSrsQueue(inbox, NOW, NO_FUZZ).length;
    const stats = getSrsStats(inbox, NOW, NO_FUZZ, dueNow);
    expect(stats.reviewedToday).toBe(1);
  });

  it('caps new available today at the remaining daily capacity', () => {
    const startOfToday = new Date(
      new Date(NOW).getFullYear(),
      new Date(NOW).getMonth(),
      new Date(NOW).getDate(),
    ).getTime();
    const consumed = migrateReviewState(word({
      id: 'consumed',
      review: {
        scheduler: 'fsrs-v1',
        cardState: 'review',
        dueAt: NOW + DAY_MS,
        intervalDays: 1,
        repetitions: 1,
        lapses: 0,
        stability: 1,
        difficulty: 5,
        reviewLog: [{
          reviewedAt: startOfToday + 60_000,
          rating: 'good',
          elapsedDays: 0,
          scheduledDays: 1,
          stateBefore: 'new',
          stateAfter: 'review',
        }],
      },
    }));
    const inbox: Inbox = {
      words: [
        consumed,
        migrateReviewState(word({ id: 'new-1' })),
        migrateReviewState(word({ id: 'new-2' })),
        migrateReviewState(word({ id: 'new-3' })),
      ],
      quotes: [],
    };

    const settings = { ...NO_FUZZ, newCardsPerDay: 2 };
    const dueNow = buildSrsQueue(inbox, NOW, settings).length;
    const stats = getSrsStats(inbox, NOW, settings, dueNow);

    expect(stats.newAvailableToday).toBe(1);
  });

  it('shows retention only after ten logged reviews', () => {
    const logs = Array.from({ length: 10 }, (_, index) => ({
      reviewedAt: NOW - index,
      rating: index === 0 ? 'again' as const : 'good' as const,
      elapsedDays: 1,
      scheduledDays: 1,
      stateBefore: 'review' as const,
      stateAfter: 'review' as const,
    }));
    const withLogs = (reviewLog: typeof logs): Inbox => ({
      words: [migrateReviewState(word({
        review: {
          scheduler: 'fsrs-v1',
          cardState: 'review',
          dueAt: NOW + DAY_MS,
          intervalDays: 1,
          repetitions: reviewLog.length,
          lapses: 1,
          stability: 1,
          difficulty: 5,
          reviewLog,
        },
      }))],
      quotes: [],
    });

    const beforeThreshold = withLogs(logs.slice(0, 9));
    const atThreshold = withLogs(logs);
    expect(
      getSrsStats(
        beforeThreshold,
        NOW,
        NO_FUZZ,
        buildSrsQueue(beforeThreshold, NOW, NO_FUZZ).length,
      ).retention,
    ).toBeNull();
    expect(
      getSrsStats(
        atThreshold,
        NOW,
        NO_FUZZ,
        buildSrsQueue(atThreshold, NOW, NO_FUZZ).length,
      ).retention,
    ).toBe(0.9);
  });
});

describe('getNextSrsWakeAt', () => {
  it('returns the next future due timestamp so sub-day cards wake the dashboard', () => {
    const dueAt = NOW + 10 * 60_000;
    const inbox: Inbox = {
      words: [migrateReviewState(word({
        review: {
          scheduler: 'fsrs-v1',
          cardState: 'learning',
          dueAt,
          intervalDays: 0,
          repetitions: 1,
          lapses: 0,
          stability: 1,
          difficulty: 5,
          learningSteps: 1,
          lastReviewedAt: NOW,
        },
      }))],
      quotes: [],
    };

    expect(getNextSrsWakeAt(inbox, NOW)).toBe(dueAt);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/srs.test.ts`
Expected: FAIL — `buildSrsQueue`, `getSrsStats`, `getNextSrsWakeAt`, and `SrsQueueItem` are not exported.

- [ ] **Step 3: Implement the queue builder and stats**

Append to `lib/srs.ts`:

```ts
import type { Inbox } from './types';

export interface SrsQueueItem {
  kind: Entry['kind'];
  entry: Entry;
  dueAt: number;
}

export interface SrsStats {
  dueNow: number;
  dueLaterToday: number;
  newAvailableToday: number;
  reviewedToday: number;
  retention: number | null;
}

const STATE_RANK: Record<ReviewCardState, number> = {
  learning: 0,
  relearning: 0,
  review: 1,
  new: 2,
};

function startOfDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function startOfNextDay(time: number): number {
  const date = new Date(time);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
}

function endOfDay(time: number): number {
  return startOfNextDay(time) - 1;
}

function countNewReviewedToday(entries: Entry[], now: number): number {
  const dayStart = startOfDay(now);
  const nextDay = startOfNextDay(now);
  let count = 0;
  for (const entry of entries) {
    for (const log of entry.review?.reviewLog ?? []) {
      if (log.stateBefore === 'new' && log.reviewedAt >= dayStart && log.reviewedAt < nextDay) {
        count += 1;
      }
    }
  }
  return count;
}

/**
 * Build the due queue. Membership uses `dueAt <= now` (full timestamps, not
 * end-of-day) so sub-day learning/relearning steps work correctly.
 */
export function buildSrsQueue(
  inbox: Inbox,
  now: number,
  settings: SrsSettings,
): SrsQueueItem[] {
  const entries: Entry[] = [...inbox.words, ...inbox.quotes].filter(
    (entry) => entry.status !== 'archived',
  );

  const newReviewedToday = countNewReviewedToday(entries, now);
  let newShown = 0;
  const newCapacity = Math.max(0, settings.newCardsPerDay - newReviewedToday);

  const items: SrsQueueItem[] = [];
  for (const raw of entries) {
    const entry = migrateReviewState(raw, now);
    const review = entry.review!;
    if (review.dueAt > now) continue;

    if (review.cardState === 'new') {
      if (newShown >= newCapacity) continue; // hidden by cap, not mutated
      newShown += 1;
    }

    items.push({ kind: entry.kind, entry, dueAt: review.dueAt });
  }

  items.sort((a, b) => {
    const ra = a.entry.review?.cardState ?? 'new';
    const rb = b.entry.review?.cardState ?? 'new';
    if (STATE_RANK[ra] !== STATE_RANK[rb]) return STATE_RANK[ra] - STATE_RANK[rb];
    // repeated same-session cards (queueRank set) sort behind untouched due cards
    const aRepeated = a.entry.review?.queueRank !== undefined;
    const bRepeated = b.entry.review?.queueRank !== undefined;
    if (aRepeated !== bRepeated) return aRepeated ? 1 : -1;
    if (aRepeated && bRepeated) {
      return (a.entry.review!.queueRank! - b.entry.review!.queueRank!);
    }
    if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    if (a.entry.createdAt !== b.entry.createdAt) return a.entry.createdAt - b.entry.createdAt;
    return a.entry.id.localeCompare(b.entry.id);
  });

  return items;
}

/** Local, textual dashboard stats. */
export function getSrsStats(
  inbox: Inbox,
  now: number,
  settings: SrsSettings,
  dueNowCount: number,
): SrsStats {
  const entries: Entry[] = [...inbox.words, ...inbox.quotes].filter(
    (entry) => entry.status !== 'archived',
  );

  let dueLaterToday = 0;
  let dueNewCards = 0;
  const dayEnd = endOfDay(now);

  const newReviewedToday = countNewReviewedToday(entries, now);
  const newCapacity = Math.max(0, settings.newCardsPerDay - newReviewedToday);

  for (const raw of entries) {
    const entry = migrateReviewState(raw, now);
    const review = entry.review!;
    if (review.cardState === 'new' && review.dueAt <= dayEnd) dueNewCards += 1;
    if (review.dueAt > now && review.dueAt <= dayEnd) dueLaterToday += 1;
  }

  const dayStart = startOfDay(now);
  const nextDay = startOfNextDay(now);
  let reviewedToday = 0;
  let remembered = 0;
  let totalReviews = 0;
  for (const entry of entries) {
    for (const log of entry.review?.reviewLog ?? []) {
      if (log.reviewedAt >= dayStart && log.reviewedAt < nextDay) {
        reviewedToday += 1;
      }
      // retention estimate across all logs
      totalReviews += 1;
      if (log.rating !== 'again') remembered += 1;
    }
  }

  return {
    dueNow: dueNowCount,
    dueLaterToday,
    newAvailableToday: Math.min(newCapacity, dueNewCards),
    reviewedToday,
    retention: totalReviews >= 10 ? remembered / totalReviews : null,
  };
}

/**
 * Wake the dashboard at the next future due timestamp. Local midnight is also
 * a wake point because the daily new-card allowance resets then.
 */
export function getNextSrsWakeAt(inbox: Inbox, now: number): number {
  let next = startOfNextDay(now);
  for (const raw of [...inbox.words, ...inbox.quotes]) {
    if (raw.status === 'archived') continue;
    const dueAt = migrateReviewState(raw, now).review!.dueAt;
    if (dueAt > now && dueAt < next) next = dueAt;
  }
  return next;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/srs.test.ts`
Expected: PASS (all SRS tests).

- [ ] **Step 5: Commit**

```bash
git add lib/srs.ts tests/srs.test.ts
git commit -m "feat(srs): add buildSrsQueue with dueAt<=now and newCardsPerDay cap, plus stats"
```

---

## Task 8: Convert `lib/review.ts` into a compatibility re-export layer

`lib/review.ts` is imported by `App.tsx` and `ReviewQueue.tsx`. Turn it into a thin queue-only compatibility layer while Tasks 9–10 move UI actions to the SRS API. The old action functions are intentionally removed in the same combined compiling commit as their call sites.

**Files:**
- Modify: `lib/review.ts`
- Modify: `tests/review.test.ts`

- [ ] **Step 1: Replace `lib/review.ts` with compatibility re-exports**

Overwrite `lib/review.ts`:

```ts
/**
 * Compatibility layer. The real scheduler lives in lib/srs.ts (FSRS). These
 * exports keep the queue item shape stable for components that App.tsx will
 * rewire in a later task. New code should import from lib/srs.ts directly.
 */
import { buildSrsQueue as buildQueue, type SrsQueueItem } from './srs';
import type { Entry, Inbox } from './types';

export type { SrsQueueItem as ReviewQueueItem } from './srs';

export function buildReviewQueue(inbox: Inbox, now = Date.now()): SrsQueueItem[] {
  // Deprecated compatibility adapter: intentionally use production defaults.
  // App.tsx imports buildSrsQueue directly and passes the user's real settings.
  return buildQueue(inbox, now, {
    desiredRetention: 0.9,
    maximumIntervalDays: 3650,
    newCardsPerDay: 20,
    enableFuzz: true,
  });
}

/** Kept for type compatibility with any remaining references. */
export type ReviewEntry = Entry;
```

Remove `viewReview`, `skipReview`, and `repeatReview`; Task 9 removes their known `App.tsx` call sites in the same combined commit.

- [ ] **Step 2: Update `tests/review.test.ts` to compatibility coverage**

The old fixed-ladder assertions no longer hold. Replace the file contents with reduced compatibility coverage that documents the new contract:

```ts
import { describe, expect, it } from 'vitest';
import type { Inbox, WordEntry } from '../lib/types';
import { migrateReviewState } from '../lib/srs';
import { buildReviewQueue } from '../lib/review';

const NOW = new Date('2026-06-20T10:30:00').getTime();
const YESTERDAY = new Date('2026-06-19T08:00:00').getTime();

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'word-1',
    kind: 'word',
    text: '山水',
    normalized: '山水',
    note: '',
    status: 'inbox',
    createdAt: YESTERDAY,
    updatedAt: YESTERDAY,
    occurrences: [],
    ...overrides,
  };
}

describe('review compatibility layer', () => {
  it('buildReviewQueue delegates to the SRS queue builder', () => {
    const inbox: Inbox = {
      words: [
        migrateReviewState(word({ id: 'due' })),
        migrateReviewState(word({ id: 'archived', status: 'archived' })),
      ],
      quotes: [],
    };
    const ids = buildReviewQueue(inbox, NOW).map((i) => i.entry.id);
    expect(ids).toEqual(['due']);
  });
});
```

- [ ] **Step 3: Run the review test**

Run: `npx vitest run tests/review.test.ts`
Expected: PASS.

- [ ] **Step 4: Do not commit yet**

`App.tsx` still imports `viewReview`/`skipReview`/`repeatReview`, so committing now would leave the tree uncompiling. The `lib/review.ts` and `tests/review.test.ts` changes are committed together with the `App.tsx` and `ReviewQueue.tsx` rewires at the end of Task 10, so every commit compiles. Proceed to Task 9.

---

## Task 9: Rewire `App.tsx`, wake at sub-day due times, and render SRS analytics

Replace the View/Skip/Later handlers with `answerReview` and `postponeReview`, build the queue with real settings, keep global counts independent of search filtering, and schedule a render at the next due timestamp. Render the five textual analytics from the spec instead of merely calculating unused fields.

**Files:**
- Modify: `entrypoints/dashboard/App.tsx`
- Modify: `lib/i18n.ts`
- Modify: `tests/i18n.test.ts`

- [ ] **Step 1: Update imports**

In `entrypoints/dashboard/App.tsx`, import `useEffect` and replace the old review imports:

```ts
import { useEffect, useMemo, useState } from 'react';
import {
  answerReview,
  buildSrsQueue,
  getNextSrsWakeAt,
  getSrsStats,
  postponeReview,
  startOfNextDay,
  type SrsQueueItem,
  type SrsStats,
} from '@/lib/srs';
import type {
  Entry,
  Inbox as InboxState,
  QuoteEntry,
  ReviewRating,
  Status,
  UiLocale,
  WordEntry,
} from '@/lib/types';
```

Remove `buildReviewQueue`, `repeatReview`, `skipReview`, and `viewReview`.

- [ ] **Step 2: Add a clock that wakes at the next due time**

After the existing state declarations, add:

```ts
  const [reviewNow, setReviewNow] = useState(() => Date.now());
```

After `normalizedQuery`, add:

```ts
  const nextSrsWakeAt = useMemo(
    () => getNextSrsWakeAt(inbox, reviewNow),
    [inbox, reviewNow],
  );

  useEffect(() => {
    const delay = Math.max(250, nextSrsWakeAt - Date.now());
    const timer = window.setTimeout(
      () => setReviewNow(Date.now()),
      Math.min(delay, 2_147_000_000),
    );
    return () => window.clearTimeout(timer);
  }, [nextSrsWakeAt]);
```

This timer is necessary because an FSRS learning card can become due minutes later without any storage or React state change. `getNextSrsWakeAt` also wakes at local midnight so the new-card allowance resets.

- [ ] **Step 3: Build one queue/stats snapshot, then apply search filtering**

Replace the current review queue/stat memo blocks with:

```ts
  const srsSnapshot = useMemo(() => {
    const items = buildSrsQueue(inbox, reviewNow, settings.srs);
    return {
      items,
      stats: getSrsStats(
        inbox,
        reviewNow,
        settings.srs,
        items.length,
      ),
    };
  }, [inbox, reviewNow, settings.srs]);

  const allReviewItems: SrsQueueItem[] = srsSnapshot.items;
  const srsStats: SrsStats = srsSnapshot.stats;

  const reviewItems = useMemo(
    () =>
      allReviewItems.filter((item) =>
        entryMatchesQuery(item.entry, normalizedQuery),
      ),
    [allReviewItems, normalizedQuery],
  );

  const reviewDueCount = allReviewItems.length;

  const stats = useMemo(() => {
    const entries = [...inbox.words, ...inbox.quotes];
    return {
      review: reviewDueCount,
      inbox: entries.filter((entry) => entry.status === 'inbox').length,
      reviewed: entries.filter((entry) => entry.status === 'reviewed').length,
      archived: entries.filter((entry) => entry.status === 'archived').length,
    };
  }, [inbox, reviewDueCount]);
```

This computes and sorts the queue once per input change. `getSrsStats` receives
the already-computed due-now count, so its other analytics cannot accidentally
rebuild the queue. The tab/header count remains global while search only filters
the cards being displayed.

- [ ] **Step 4: Preserve the existing entry-update helper**

`entrypoints/dashboard/App.tsx` already defines `updateReviewEntry` below the
component. Keep this helper unchanged; the new answer/postpone handlers call it:

```ts
function updateReviewEntry(
  inbox: InboxState,
  kind: Entry['kind'],
  id: string,
  update: (entry: Entry) => Entry,
): InboxState {
  if (kind === 'word') {
    return {
      ...inbox,
      words: inbox.words.map((word) =>
        word.id === id ? (update(word) as WordEntry) : word,
      ),
    };
  }

  return {
    ...inbox,
    quotes: inbox.quotes.map((quote) =>
      quote.id === id ? (update(quote) as QuoteEntry) : quote,
    ),
  };
}
```

- [ ] **Step 5: Replace the old review handlers**

Remove `viewEntry`, `skipEntry`, and `repeatEntry`, then add:

```ts
  function answerEntry(kind: Entry['kind'], id: string, rating: ReviewRating) {
    const now = Date.now();
    mutate((current) =>
      updateReviewEntry(current, kind, id, (entry) =>
        answerReview(entry, rating, now, settings.srs),
      ),
    );
  }

  function postponeEntry(kind: Entry['kind'], id: string) {
    const now = Date.now();
    const dueAt = startOfNextDay(now);
    mutate((current) =>
      updateReviewEntry(current, kind, id, (entry) =>
        postponeReview(entry, now, dueAt),
      ),
    );
  }
```

`startOfNextDay` is imported from `lib/srs.ts`; do not duplicate the local-day
calculation in `App.tsx`.

- [ ] **Step 6: Add localized analytics labels**

Append this test to `tests/i18n.test.ts`:

```ts
  it('returns SRS analytics labels in both locales', () => {
    expect(t('en', 'srs.dueNow')).toBe('Due now');
    expect(t('en', 'srs.dueLaterToday')).toBe('Later today');
    expect(t('en', 'srs.newAvailableToday')).toBe('New today');
    expect(t('en', 'srs.reviewedToday')).toBe('Reviewed today');
    expect(t('en', 'srs.retention')).toBe('Retention');
    expect(t('zh-CN', 'srs.dueNow')).toBe('现在到期');
    expect(t('zh-CN', 'srs.retention')).toBe('记忆率');
  });
```

Add to the English messages:

```ts
    'srs.dueNow': 'Due now',
    'srs.dueLaterToday': 'Later today',
    'srs.newAvailableToday': 'New today',
    'srs.reviewedToday': 'Reviewed today',
    'srs.retention': 'Retention',
```

Add to the `zh-CN` messages:

```ts
    'srs.dueNow': '现在到期',
    'srs.dueLaterToday': '今日稍后',
    'srs.newAvailableToday': '今日新卡',
    'srs.reviewedToday': '今日已复习',
    'srs.retention': '记忆率',
```

- [ ] **Step 7: Render the analytics and pass the new review props**

Immediately after `<Toolbar ... />`, add:

```tsx
        <SrsStatsPanel stats={srsStats} locale={locale} />
```

Replace the `<ReviewQueue ... />` usage:

```tsx
            <ReviewQueue
              items={reviewItems}
              onAnswer={answerEntry}
              onPostpone={postponeEntry}
              locale={locale}
            />
```

Add this helper component near `StatCard`:

```tsx
function SrsStatsPanel({
  stats,
  locale,
}: {
  stats: SrsStats;
  locale: UiLocale;
}) {
  const items = [
    [t(locale, 'srs.dueNow'), String(stats.dueNow)],
    [t(locale, 'srs.dueLaterToday'), String(stats.dueLaterToday)],
    [t(locale, 'srs.newAvailableToday'), String(stats.newAvailableToday)],
    [t(locale, 'srs.reviewedToday'), String(stats.reviewedToday)],
    [
      t(locale, 'srs.retention'),
      stats.retention === null ? '—' : `${Math.round(stats.retention * 100)}%`,
    ],
  ] as const;

  return (
    <dl className="grid gap-2 rounded-sm border border-border bg-paper-light p-3 text-center sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="rounded-sm bg-paper-input px-2 py-2">
          <dt className="text-[11px] tracking-[1px] text-muted">{label}</dt>
          <dd className="mt-1 text-lg font-semibold text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
```

- [ ] **Step 8: Run focused tests and compile to the expected transition point**

Run:
```bash
npx vitest run tests/srs.test.ts tests/i18n.test.ts
npm run compile
```
Expected: SRS and i18n tests pass. Compile errors are limited to `ReviewQueue.tsx` still exposing the old props; Task 10 fixes those before the combined commit.

---

## Task 10: Rebuild `ReviewQueue.tsx` for the Reveal-then-rate flow

Replace the View/Skip/Later buttons with a **Reveal** step followed by Again/Hard/Good/Easy rating buttons and a secondary Postpone. Hide answer details (pinyin/definitions/source examples/AI for words; quote text/note/source for quotes) until Reveal.

**Files:**
- Modify: `entrypoints/dashboard/components/ReviewQueue.tsx`
- Modify: `entrypoints/dashboard/components/ReviewInsightReveal.tsx`
- Create: `tests/review-queue.test.tsx`

- [ ] **Step 1: Write a failing component test for the reveal-then-rate flow**

Create `tests/review-queue.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import {
  ReviewCard,
  ReviewQueue,
} from '../entrypoints/dashboard/components/ReviewQueue';
import { migrateReviewState } from '../lib/srs';
import { messages } from '../lib/i18n';
import type { QuoteEntry, WordEntry } from '../lib/types';

const NOW = new Date('2026-06-24T10:00:00').getTime();

function word(overrides: Partial<WordEntry> = {}): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    occurrences: [],
    ...overrides,
  };
}

function quote(overrides: Partial<QuoteEntry> = {}): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '学而时习之',
    tags: [],
    note: 'a note',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    category: 'classic',
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com',
    sourceDomain: 'example.com',
    surrounding: '学而时习之，不亦说乎',
    ...overrides,
  };
}

describe('ReviewQueue reveal-then-rate flow', () => {
  it('has Again/Hard/Good/Easy and Reveal/Postpone labels in i18n', () => {
    expect(messages.en).toHaveProperty('review.reveal');
    expect(messages.en).toHaveProperty('review.again');
    expect(messages.en).toHaveProperty('review.hard');
    expect(messages.en).toHaveProperty('review.good');
    expect(messages.en).toHaveProperty('review.easy');
    expect(messages.en).toHaveProperty('review.postpone');
    expect(messages['zh-CN']).toHaveProperty('review.reveal');
    expect(messages['zh-CN']).toHaveProperty('review.again');
  });

  it('shows the word prompt and a Reveal button before answer details', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'word', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    expect(html).toContain('你好');
    expect(html).toContain(messages.en['review.reveal']);
  });

  it('hides the quote text until reveal (shows category/source first)', () => {
    const entry = migrateReviewState(quote(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'quote', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );
    expect(html).toContain('classic');
    expect(html).toContain(messages.en['review.reveal']);
    // quote text hidden in prompt-only render
    expect(html).not.toContain('学而时习之');
  });

  it('shows quote answer details and rating controls after reveal', () => {
    const entry = migrateReviewState(quote(), NOW);
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'quote', entry, dueAt: NOW }}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
        initiallyRevealed
      />,
    );
    expect(html).toContain('学而时习之');
    expect(html).toContain('a note');
    expect(html).toContain(messages.en['review.again']);
    expect(html).toContain(messages.en['review.easy']);
  });

  it('opens the existing word insight reveal with the main answer reveal', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'word', entry, dueAt: NOW }}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
        initiallyRevealed
      />,
    );
    expect(html).not.toContain(messages.en['review.showDefinitions']);
    expect(html).toContain(messages.en['review.good']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/review-queue.test.tsx`
Expected: FAIL — `ReviewQueue` still uses `onView`/`onSkip`/`onRepeat` and the new i18n keys don't exist.

- [ ] **Step 3: Add the new i18n keys**

In `lib/i18n.ts`, add to the `en` messages object (near the existing `review.*` keys):

```ts
    'review.reveal': 'Reveal',
    'review.revealTitle': 'Show the answer',
    'review.again': 'Again',
    'review.hard': 'Hard',
    'review.good': 'Good',
    'review.easy': 'Easy',
    'review.againTitle': 'Forgot — show again soon',
    'review.hardTitle': 'Recalled with serious effort',
    'review.goodTitle': 'Recalled correctly',
    'review.easyTitle': 'Recalled instantly',
    'review.postpone': 'Postpone',
    'review.postponeTitle': 'Show this card tomorrow',
```

Add the matching `zh-CN` entries:

```ts
    'review.reveal': '显示答案',
    'review.revealTitle': '查看答案',
    'review.again': '忘了',
    'review.hard': '困难',
    'review.good': '记得',
    'review.easy': '简单',
    'review.againTitle': '想不起来，很快再看',
    'review.hardTitle': '费很大劲才想起来',
    'review.goodTitle': '正确回想起来',
    'review.easyTitle': '一下子就想起来了',
    'review.postpone': '延后',
    'review.postponeTitle': '这张卡片明天再看',
```

- [ ] **Step 4: Let the existing word insight reveal start open**

Update `entrypoints/dashboard/components/ReviewInsightReveal.tsx`:

```tsx
export function ReviewInsightReveal({
  word,
  locale,
  initiallyRevealed = false,
}: {
  word: WordEntry;
  locale: UiLocale;
  initiallyRevealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(initiallyRevealed);

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
      >
        {t(locale, 'review.showDefinitions')}
      </button>
    );
  }

  return <RevealedReviewInsight word={word} locale={locale} />;
}
```

The default remains closed for any existing standalone use. `ReviewQueue` mounts it with `initiallyRevealed` only after the main answer reveal, avoiding a second reveal click.

- [ ] **Step 5: Rewrite `ReviewQueue.tsx`**

Overwrite `entrypoints/dashboard/components/ReviewQueue.tsx`:

```tsx
import { Eye, MessageSquareQuote, WholeWord, RotateCw } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { Entry, ReviewRating, UiLocale } from '@/lib/types';
import type { SrsQueueItem } from '@/lib/srs';
import { ReviewInsightReveal } from './ReviewInsightReveal';

const RATINGS: Array<{ rating: ReviewRating; labelKey: 'review.again' | 'review.hard' | 'review.good' | 'review.easy'; titleKey: 'review.againTitle' | 'review.hardTitle' | 'review.goodTitle' | 'review.easyTitle'; tone: 'muted' | 'cinnabar' | 'good' | 'easy' }> = [
  { rating: 'again', labelKey: 'review.again', titleKey: 'review.againTitle', tone: 'muted' },
  { rating: 'hard', labelKey: 'review.hard', titleKey: 'review.hardTitle', tone: 'cinnabar' },
  { rating: 'good', labelKey: 'review.good', titleKey: 'review.goodTitle', tone: 'good' },
  { rating: 'easy', labelKey: 'review.easy', titleKey: 'review.easyTitle', tone: 'easy' },
];

export function ReviewQueue({
  items,
  onAnswer,
  onPostpone,
  locale,
}: {
  items: SrsQueueItem[];
  onAnswer: (kind: Entry['kind'], id: string, rating: ReviewRating) => void;
  onPostpone: (kind: Entry['kind'], id: string) => void;
  locale: UiLocale;
}) {
  if (items.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-12 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center text-[56px] leading-none text-ink/12">
          习
        </div>
        <p className="text-base font-medium text-ink-secondary tracking-[3px]">{t(locale, 'review.emptyTitle')}</p>
        <p className="mt-1 text-xs text-muted">{t(locale, 'review.emptyBody')}</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {items.map((item) => (
        <ReviewCard
          key={`${item.kind}:${item.entry.id}`}
          item={item}
          onAnswer={(rating) => onAnswer(item.kind, item.entry.id, rating)}
          onPostpone={() => onPostpone(item.kind, item.entry.id)}
          locale={locale}
        />
      ))}
    </div>
  );
}

export function ReviewCard({
  item,
  onAnswer,
  onPostpone,
  locale,
  initiallyRevealed = false,
}: {
  item: SrsQueueItem;
  onAnswer: (rating: ReviewRating) => void;
  onPostpone: () => void;
  locale: UiLocale;
  initiallyRevealed?: boolean;
}) {
  const { entry } = item;
  const [revealed, setRevealed] = useState(initiallyRevealed);
  const source = getSourceLabel(entry);

  return (
    <article className="rounded-sm border border-border bg-paper-light p-4 shadow-sm transition hover:border-border-hover hover:shadow-md">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
        <span className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 font-medium text-cinnabar tracking-[1px]">
          {entry.kind === 'word' ? (
            <WholeWord className="h-3.5 w-3.5" />
          ) : (
            <MessageSquareQuote className="h-3.5 w-3.5" />
          )}
          {entry.kind === 'word' ? t(locale, 'review.kindWord') : t(locale, 'review.kindQuote')}
        </span>
        <span className="rounded-sm border border-border bg-paper-input px-2 py-1">
          {entry.status === 'inbox' ? t(locale, 'app.inbox') : t(locale, 'app.reviewed')}
        </span>
        {entry.kind === 'quote' && (
          <span className="rounded-sm border border-border bg-paper-input px-2 py-1">{entry.category}</span>
        )}
        {source && <span className="truncate rounded-sm border border-border bg-paper-input px-2 py-1">{source}</span>}
      </div>

      {entry.kind === 'word' ? (
        <h2 className="mt-3 text-[32px] font-bold leading-none text-ink tracking-[4px]">{entry.text}</h2>
      ) : (
        // Quote prompt: category/source label only until reveal
        <p className="mt-3 text-sm text-muted tracking-[1px]">
          {revealed ? null : t(locale, 'review.revealTitle')}
        </p>
      )}

      {/* Answer area — only after reveal */}
      {revealed && entry.kind === 'quote' && (
        <blockquote className="relative mt-3 border-l-[3px] border-cinnabar-fade py-1 pl-5 pr-4 text-base leading-8 text-ink tracking-[1px]">
          <span aria-hidden="true" className="absolute left-2 top-0 text-xl text-cinnabar/40">「</span>
          <span>{entry.text}</span>
          <span aria-hidden="true" className="absolute bottom-0 right-1 text-xl text-cinnabar/40">」</span>
        </blockquote>
      )}

      {revealed && entry.kind === 'quote' && entry.note && (
        <p className="mt-3 rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {entry.note}
        </p>
      )}

      {revealed && entry.kind === 'word' && (
        <ReviewInsightReveal word={entry} locale={locale} initiallyRevealed />
      )}

      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            title={t(locale, 'review.revealTitle')}
            className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2 text-sm font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95"
          >
            <Eye className="h-4 w-4" /> {t(locale, 'review.reveal')}
          </button>
        ) : (
          <>
            {RATINGS.map(({ rating, labelKey, titleKey, tone }) => (
              <button
                key={rating}
                onClick={() => onAnswer(rating)}
                title={t(locale, titleKey)}
                className={`inline-flex items-center gap-1 rounded-sm px-3 py-2 text-sm font-medium tracking-[2px] transition ${toneClasses(tone)}`}
              >
                {t(locale, labelKey)}
              </button>
            ))}
            <button
              onClick={onPostpone}
              title={t(locale, 'review.postponeTitle')}
              className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-3 py-2 text-sm font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
            >
              <RotateCw className="h-4 w-4" /> {t(locale, 'review.postpone')}
            </button>
          </>
        )}
      </div>
    </article>
  );
}

function toneClasses(tone: 'muted' | 'cinnabar' | 'good' | 'easy'): string {
  switch (tone) {
    case 'muted':
      return 'border border-border bg-transparent text-ink-secondary hover:border-border-hover hover:bg-paper-input';
    case 'cinnabar':
      return 'border border-cinnabar-border bg-cinnabar-light text-cinnabar hover:bg-cinnabar hover:text-white';
    case 'good':
      return 'bg-cinnabar text-white shadow-sm hover:brightness-95';
    case 'easy':
      return 'border border-border bg-paper-input text-ink hover:border-cinnabar-fade';
  }
}

function getSourceLabel(entry: Entry): string {
  if (entry.kind === 'quote') {
    return entry.sourceTitle || entry.sourceDomain;
  }
  const latest = entry.occurrences[entry.occurrences.length - 1];
  return latest?.sourceTitle || latest?.sourceDomain || '';
}
```

- [ ] **Step 6: Run the component test to verify it passes**

Run: `npx vitest run tests/review-queue.test.tsx`
Expected: PASS.

- [ ] **Step 7: Compile the whole tree, then commit Tasks 8 + 9 + 10 together**

Run: `npm run compile`
Expected: exits 0 (now that `ReviewQueue.tsx` defines `onAnswer`/`onPostpone`).

Commit all the staged changes from Tasks 8, 9, and 10 in one compiling commit:

```bash
git add lib/review.ts lib/i18n.ts entrypoints/dashboard/App.tsx entrypoints/dashboard/components/ReviewQueue.tsx entrypoints/dashboard/components/ReviewInsightReveal.tsx tests/review.test.ts tests/review-queue.test.tsx tests/i18n.test.ts
git commit -m "feat(srs): reveal-then-rate review flow, FSRS-wired App, compat lib/review"
```

---

## Task 11: Add an SRS settings section to the Settings page

Expose desired retention (slider/select), maximum interval, and new cards per day. Stored via `setSrsSettings`.

**Files:**
- Modify: `entrypoints/settings/SettingsApp.tsx`
- Modify: `lib/i18n.ts` (labels)

- [ ] **Step 1: Write a failing test for the new i18n keys**

Append to `tests/i18n.test.ts`:

```ts
  it('returns SRS settings labels in both locales', () => {
    expect(t('en', 'settings.srs')).toBe('Spaced repetition');
    expect(t('en', 'settings.srsDesiredRetention')).toBe('Target retention');
    expect(t('en', 'settings.srsMaxInterval')).toBe('Maximum interval (days)');
    expect(t('en', 'settings.srsNewPerDay')).toBe('New cards per day');
    expect(t('zh-CN', 'settings.srs')).toBe('间隔复习');
    expect(t('zh-CN', 'settings.srsDesiredRetention')).toBe('目标记忆率');
    expect(t('zh-CN', 'settings.srsMaxInterval')).toBe('最大间隔（天）');
    expect(t('zh-CN', 'settings.srsNewPerDay')).toBe('每日新卡片数');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL — keys missing.

- [ ] **Step 3: Add the i18n keys**

In `lib/i18n.ts` `en` object:

```ts
    'settings.srs': 'Spaced repetition',
    'settings.srsDesiredRetention': 'Target retention',
    'settings.srsDesiredRetentionHint': 'Higher means shorter intervals and more reviews. 0.90 is a good default.',
    'settings.srsMaxInterval': 'Maximum interval (days)',
    'settings.srsNewPerDay': 'New cards per day',
```

In the `zh-CN` object:

```ts
    'settings.srs': '间隔复习',
    'settings.srsDesiredRetention': '目标记忆率',
    'settings.srsDesiredRetentionHint': '越高则间隔越短、复习越频繁。0.90 是不错的默认值。',
    'settings.srsMaxInterval': '最大间隔（天）',
    'settings.srsNewPerDay': '每日新卡片数',
```

- [ ] **Step 4: Add the SRS settings section to `SettingsApp.tsx`**

Add imports:

```ts
import { Gauge } from 'lucide-react';
import { DEFAULT_SRS_SETTINGS, setSrsSettings } from '@/lib/settings';
```

Inside the `SettingsApp` component, after the Kaikki section and before `<AiSettingsPanel .../>`, add a new section:

```tsx
        <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
          <div className="mb-3 flex items-center gap-2">
            <Gauge className="h-4 w-4 text-cinnabar" />
            <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'settings.srs')}</h2>
          </div>
          <p className="mb-3 text-xs leading-6 text-muted">{t(locale, 'settings.srsDesiredRetentionHint')}</p>

          <label className="block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.srsDesiredRetention')}
            <select
              value={String(settings.srs.desiredRetention)}
              onChange={(event) =>
                mutate((current) =>
                  setSrsSettings(current, {
                    ...current.srs,
                    desiredRetention: Number(event.target.value),
                  }),
                )
              }
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
            >
              {[0.8, 0.85, 0.9, 0.92, 0.95, 0.97].map((value) => (
                <option key={value} value={value}>
                  {Math.round(value * 100)}%
                </option>
              ))}
            </select>
          </label>

          <label className="mt-3 block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.srsMaxInterval')}
            <input
              type="number"
              min={1}
              value={settings.srs.maximumIntervalDays}
              onChange={(event) =>
                mutate((current) =>
                  setSrsSettings(current, {
                    ...current.srs,
                    maximumIntervalDays: Math.max(1, Number(event.target.value) || DEFAULT_SRS_SETTINGS.maximumIntervalDays),
                  }),
                )
              }
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
            />
          </label>

          <label className="mt-3 block text-xs font-medium tracking-[1px] text-muted">
            {t(locale, 'settings.srsNewPerDay')}
            <input
              type="number"
              min={0}
              value={settings.srs.newCardsPerDay}
              onChange={(event) =>
                mutate((current) =>
                  setSrsSettings(current, {
                    ...current.srs,
                    newCardsPerDay: Math.max(0, Number(event.target.value) || 0),
                  }),
                )
              }
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-3 py-2 text-sm text-ink outline-none transition focus:border-cinnabar-fade"
            />
          </label>
        </section>
```

- [ ] **Step 5: Run i18n test and compile**

Run: `npx vitest run tests/i18n.test.ts && npm run compile`
Expected: PASS / exits 0.

- [ ] **Step 6: Commit**

```bash
git add lib/i18n.ts entrypoints/settings/SettingsApp.tsx tests/i18n.test.ts
git commit -m "feat(srs): add SRS settings section (retention, max interval, new/day)"
```

---

## Task 12: Validate new FSRS fields in backup parsing

Extend `isReviewState` to validate the optional FSRS fields so malformed SRS state is rejected (not silently kept).

**Files:**
- Modify: `lib/backup.ts` (`isReviewState`)
- Modify: `tests/backup.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `tests/backup.test.ts`:

```ts
import type { ReviewState } from '../lib/types';

const fsrsReview: ReviewState = {
  scheduler: 'fsrs-v1',
  dueAt: Date.UTC(2026, 5, 22),
  intervalDays: 3,
  repetitions: 2,
  lapses: 0,
  lastReviewedAt: Date.UTC(2026, 5, 21),
  cardState: 'review',
  stability: 3,
  difficulty: 5.5,
  elapsedDays: 3,
  scheduledDays: 3,
  learningSteps: 0,
  retrievability: 0.9,
  reviewLog: [
    {
      reviewedAt: Date.UTC(2026, 5, 21),
      rating: 'good',
      elapsedDays: 0,
      scheduledDays: 3,
      stateBefore: 'new',
      stateAfter: 'review',
      stabilityBefore: 0.1,
      stabilityAfter: 3,
      difficultyBefore: 5,
      difficultyAfter: 5,
    },
  ],
};

describe('parseBackup with FSRS review state', () => {
  it('accepts valid fsrs-v1 review state', () => {
    const inboxWithFsrs: Inbox = {
      words: [{ ...word, review: fsrsReview }],
      quotes: [],
    };
    const restored = parseBackup(serializeBackup(inboxWithFsrs));
    expect(restored.words[0].review).toEqual(fsrsReview);
  });

  it('rejects an invalid scheduler value', () => {
    const broken = {
      ...inbox,
      words: [{ ...word, review: { ...fsrsReview, scheduler: 'unknown' } }],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(BackupParseError);
  });

  it('rejects an invalid cardState value', () => {
    const broken = {
      ...inbox,
      words: [{ ...word, review: { ...fsrsReview, cardState: 'frozen' } }],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(BackupParseError);
  });

  it('rejects a malformed learning step index', () => {
    const broken = {
      ...inbox,
      words: [{ ...word, review: { ...fsrsReview, learningSteps: -1 } }],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(BackupParseError);
  });

  it('rejects a malformed review log entry', () => {
    const broken = {
      ...inbox,
      words: [
        {
          ...word,
          review: {
            ...fsrsReview,
            reviewLog: [{ reviewedAt: 'not-a-number', rating: 'good' }],
          },
        },
      ],
    };
    expect(() => parseBackup(JSON.stringify(broken))).toThrow(BackupParseError);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/backup.test.ts`
Expected: FAIL — invalid scheduler/cardState/log are currently accepted.

- [ ] **Step 3: Extend `isReviewState` and add validators in `lib/backup.ts`**

Replace the `isReviewState` function and add helpers above it:

```ts
function isReviewScheduler(value: unknown): value is ReviewScheduler {
  return value === 'fixed-v1' || value === 'fsrs-v1';
}

function isReviewCardState(value: unknown): value is ReviewCardState {
  return value === 'new' || value === 'learning' || value === 'review' || value === 'relearning';
}

function isReviewRating(value: unknown): value is ReviewRating {
  return value === 'again' || value === 'hard' || value === 'good' || value === 'easy';
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isReviewState(value: unknown): value is ReviewState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.dueAt) &&
    isFiniteNumber(value.intervalDays) &&
    isFiniteNumber(value.repetitions) &&
    isFiniteNumber(value.lapses) &&
    (value.scheduler === undefined || isReviewScheduler(value.scheduler)) &&
    (value.lastReviewedAt === undefined || isFiniteNumber(value.lastReviewedAt)) &&
    (value.queueRank === undefined || isFiniteNumber(value.queueRank)) &&
    (value.cardState === undefined || isReviewCardState(value.cardState)) &&
    (value.stability === undefined || isFiniteNumber(value.stability)) &&
    (value.difficulty === undefined || isFiniteNumber(value.difficulty)) &&
    (value.elapsedDays === undefined || isFiniteNumber(value.elapsedDays)) &&
    (value.scheduledDays === undefined || isFiniteNumber(value.scheduledDays)) &&
    (value.learningSteps === undefined || isNonNegativeInteger(value.learningSteps)) &&
    (value.retrievability === undefined || isFiniteNumber(value.retrievability)) &&
    (value.reviewLog === undefined ||
      (Array.isArray(value.reviewLog) && value.reviewLog.every(isReviewLogEntry)))
  );
}

function isReviewLogEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.reviewedAt) &&
    isReviewRating(value.rating) &&
    isFiniteNumber(value.elapsedDays) &&
    isFiniteNumber(value.scheduledDays) &&
    isReviewCardState(value.stateBefore) &&
    isReviewCardState(value.stateAfter) &&
    (value.stabilityBefore === undefined || isFiniteNumber(value.stabilityBefore)) &&
    (value.stabilityAfter === undefined || isFiniteNumber(value.stabilityAfter)) &&
    (value.difficultyBefore === undefined || isFiniteNumber(value.difficultyBefore)) &&
    (value.difficultyAfter === undefined || isFiniteNumber(value.difficultyAfter))
  );
}
```

Update the type import at the top of `lib/backup.ts` to include `ReviewCardState`, `ReviewRating`, and `ReviewScheduler` alongside the existing `ReviewState` import.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/backup.test.ts`
Expected: PASS (all backup tests).

- [ ] **Step 5: Commit**

```bash
git add lib/backup.ts tests/backup.test.ts
git commit -m "feat(srs): validate FSRS review fields in backup parsing"
```

---

## Task 13: Add concise review metadata to Markdown export

Per spec: "Markdown export should not dump the full review log. It may include concise review metadata." Add a single line per entry when SRS state exists.

**Files:**
- Modify: `lib/markdown.ts`
- Modify: `tests/markdown.test.ts`

- [ ] **Step 1: Write a failing test**

Append to `tests/markdown.test.ts`:

```ts
  it('adds a concise SRS review line when review state exists', () => {
    const reviewedWord: WordEntry = {
      ...word,
      review: {
        scheduler: 'fsrs-v1',
        dueAt: Date.UTC(2026, 6, 25),
        intervalDays: 3,
        repetitions: 2,
        lapses: 0,
        cardState: 'review',
        stability: 3,
        difficulty: 5,
        lastReviewedAt: Date.UTC(2026, 5, 20),
      },
    };
    const md = renderDay('2026-06-20', [reviewedWord], []);
    expect(md).toContain('Review:');
    expect(md).toContain('state review');
    expect(md).toContain('interval 3 days');
    // does not dump the full review log or internal stability numbers
    expect(md).not.toContain('stability');
  });
```

(Ensure the test file imports `renderDay` and `WordEntry` — check the existing imports at the top of `tests/markdown.test.ts` and add `renderDay` if missing. The existing `word` factory in that file is reused.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/markdown.test.ts`
Expected: FAIL — no `Review:` line emitted.

- [ ] **Step 3: Add the review metadata helper to `lib/markdown.ts`**

Add a helper and call it after each word/quote entry. In `lib/markdown.ts`, add near the top (after `esc`):

```ts
function reviewLine(review: WordEntry['review']): string | null {
  if (!review) return null;
  const due = new Date(review.dueAt);
  const dueStr = `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}`;
  const state = review.cardState ?? 'review';
  return `Review: due ${dueStr}, state ${state}, interval ${review.intervalDays} days`;
}
```

Inside the word loop (after the `aiInsight` block, before `lines.push('')`), add:

```ts
      const rLine = reviewLine(word.review);
      if (rLine) lines.push(`  - ${rLine}`);
```

Inside the quote loop (before the final `lines.push('')`), add:

```ts
      const rLine = reviewLine(quote.review);
      if (rLine) lines.push(`  - ${rLine}`);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/markdown.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/markdown.ts tests/markdown.test.ts
git commit -m "feat(srs): add concise review metadata line to Markdown export"
```

---

## Task 14: Update README docs

Document the real SRS feature, the four ratings, and the new settings.

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add an SRS section to README.md**

Read the current `README.md` to find the review section, then add/replace a section describing:

```md
## Spaced repetition (Review tab)

Saved words and quotes are scheduled by the FSRS algorithm (via `ts-fsrs`),
which models each item's memory from difficulty, stability, and your target
retention.

**Review flow:** each card shows the prompt first. Click **Reveal** to see the
answer, then rate your recall:

- **Again** — you forgot it; it comes back soon.
- **Hard** — you recalled it with serious effort.
- **Good** — you recalled it correctly.
- **Easy** — you recalled it instantly.

The scheduler sets the next due date from your rating. **Postpone** moves a card
to tomorrow without changing its memory state.

**Settings (Settings → Spaced repetition):**

- **Target retention** — the recall probability FSRS schedules for (default 90%).
- **Maximum interval (days)** — cap on the longest scheduling gap.
- **New cards per day** — limits how many never-reviewed cards appear each day.
  Already-learning and due review cards are never hidden by this cap.

All review data is stored locally on each entry and travels with JSON backups.
No network access is required.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs(srs): describe FSRS review flow, ratings, and settings"
```

---

## Task 15: Full verification and build

Run the complete verification gate required by the spec and AGENTS.md.

**Files:** none (verification only)

- [ ] **Step 1: Run compile**

Run: `npm run compile`
Expected: exits 0, no type errors.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: all tests pass, including `tests/srs.test.ts`, `tests/review.test.ts`, `tests/backup.test.ts`, `tests/settings.test.ts`, `tests/review-queue.test.tsx`, `tests/types-srs.test.ts`.

- [ ] **Step 3: Run the production build and inspect the manifest**

Run:
```bash
npm run build
cat .output/chrome-mv3/manifest.json
```
Expected: build succeeds; manifest still includes `contextMenus`, `storage`, `activeTab`, `scripting`, `downloads`, `unlimitedStorage`, command shortcuts, a toolbar popup, and an MV3 background service worker. No new permissions are required for SRS (it is offline).

- [ ] **Step 4: Final commit if any formatting/fixups were needed**

If steps 1–3 required no changes, no commit is needed. If fixes were applied, commit them with a clear message.

---

## Acceptance Criteria Traceability

| Spec criterion | Covered by |
|---|---|
| 1. Reveal + Again/Hard/Good/Easy | Task 10 |
| 2. Ratings produce different schedules | Task 6 (`answerReview` test) |
| 3. Persists card state, stability, difficulty, learning-step progress, due, interval, log | Tasks 2, 5, 6 |
| 4. Entries without SRS fields still appear | Tasks 5 (migration), 7 (queue) |
| 5. Fixed-ladder states migrate without losing due dates | Task 5 |
| 6. Queue uses `dueAt <= now` and wakes for future sub-day cards | Tasks 7, 9 |
| 7. SRS settings, default retention 0.90 | Tasks 3, 11 |
| 8. Old `local:settings` normalized to include `srs` | Tasks 3, 4 |
| 9. `newCardsPerDay` limits only new cards | Task 7 |
| 10. Quote prompts hide text until Reveal | Task 10 |
| 11. Backup/restore preserves SRS state | Task 12 |
| 12. compile/test/build pass | Task 15 |
| 13. No network access | by design (no fetch in `lib/srs.ts`) |
