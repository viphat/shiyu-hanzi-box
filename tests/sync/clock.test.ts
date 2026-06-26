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
