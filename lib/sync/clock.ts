import type { HybridTimestamp } from './types';

// NOTE: `compareTimestamps` and `skewMillis` are used by the merge layer for a
// deterministic total order over stamps. The hybrid logical clock below
// (`createClock` / `tick` / `observe`) is currently NOT wired into projection
// or the coordinator: conflict resolution uses plain wall-time last-write-wins
// (see lib/sync/project.ts `stamp`). The clock is intentionally retained as a
// ready primitive for a future clock-skew-hardening pass; until then it has no
// production callers by design.

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
          ? Math.max(current.counter, remote.wallTime === wall ? remote.counter : 0)
          : remote.wallTime === wall
            ? remote.counter
            : 0;
      current = { wallTime: wall, counter, replicaId };
    },
    last() {
      return current;
    },
  };
}
