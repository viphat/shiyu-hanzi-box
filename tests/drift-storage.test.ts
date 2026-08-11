import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { nudgeLevel, recordDriftDay } from '../lib/drift';
import {
  driftStorage,
  getDriftStore,
  mutateDriftStore,
  replaceDriftStore,
  watchDriftStore,
} from '../lib/drift-storage';

describe('drift storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('starts empty', async () => {
    expect(await getDriftStore()).toEqual({ weights: {}, days: {} });
  });

  it('round-trips a mutation', async () => {
    await mutateDriftStore((store) => nudgeLevel(store, '你好', 1));
    expect((await getDriftStore()).weights).toEqual({ '你好': 1 });
  });

  it('serializes concurrent mutations instead of losing one', async () => {
    await Promise.all([
      mutateDriftStore((store) => recordDriftDay(store, '2026-08-11', 1)),
      mutateDriftStore((store) => recordDriftDay(store, '2026-08-11', 1)),
      mutateDriftStore((store) => recordDriftDay(store, '2026-08-11', 1)),
    ]);
    expect((await getDriftStore()).days).toEqual({ '2026-08-11': 3 });
  });

  it('normalizes on write, so a bad value can never be persisted', async () => {
    await replaceDriftStore({ weights: { a: 99 } as never, days: {} });
    // Read the raw persisted value (fallback-applied but NOT normalized) so
    // this actually exercises the write path. Going through getDriftStore()
    // here would pass even if replaceDriftStore skipped normalization,
    // because getDriftStore() normalizes again on the way out.
    expect((await driftStorage.getValue()).weights).toEqual({ a: 2 });
  });

  it('does not wedge the chain after a mutation throws', async () => {
    await expect(
      mutateDriftStore(() => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');

    // A prior bug left the module-level chain permanently rejected after any
    // failure, silently dropping every subsequent mutation. Confirm the next
    // call still reads and writes normally.
    await mutateDriftStore((store) => nudgeLevel(store, '你好', 1));
    expect((await getDriftStore()).weights).toEqual({ '你好': 1 });
  });

  it('notifies watchers with a normalized store, and stops after unsubscribe', async () => {
    const listener = vi.fn();
    const unwatch = watchDriftStore(listener);

    // Write the raw, un-normalized value directly (bypassing replaceDriftStore,
    // which would normalize it before it ever reaches storage) so this test
    // actually exercises watchDriftStore's own normalization of the emitted
    // value, not just the value already being clean going in.
    await driftStorage.setValue({ weights: { a: 99 } as never, days: {} });

    await vi.waitFor(() => {
      expect(listener).toHaveBeenCalledWith(
        expect.objectContaining({ weights: { a: 2 } }),
      );
    });

    unwatch();
    listener.mockClear();

    await driftStorage.setValue({ weights: {}, days: {} });
    // Give any stray notification a chance to arrive before asserting none did.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
  });
});
