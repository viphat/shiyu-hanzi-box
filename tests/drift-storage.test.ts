import { fakeBrowser } from '@webext-core/fake-browser';
import { beforeEach, describe, expect, it } from 'vitest';
import { nudgeLevel, recordDriftDay } from '../lib/drift';
import {
  getDriftStore,
  mutateDriftStore,
  replaceDriftStore,
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
    expect((await getDriftStore()).weights).toEqual({ a: 2 });
  });
});
