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
