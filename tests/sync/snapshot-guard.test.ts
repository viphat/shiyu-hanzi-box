// tests/sync/snapshot-guard.test.ts
// Defense-in-depth guards: (I4)
//   1. rebuildReview must reject invalid scheduler snapshot payloads.
//   2. pickSnapshot must prefer non-orphaned snapshots over orphaned ones.
import { describe, expect, it } from 'vitest';
import { materialize, wordKey } from '../../lib/sync/project';
import { mergeWordNodes } from '../../lib/sync/merge';
import type {
  HybridTimestamp,
  ReviewEventNode,
  SchedulerSnapshotNode,
  SyncState,
  WordNode,
} from '../../lib/sync/types';
import { EMPTY_SYNC_STATE } from '../../lib/sync/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function ts(wallTime: number, replicaId = 'R'): HybridTimestamp {
  return { wallTime, counter: 0, replicaId };
}

function makeReviewEvent(id: string, reviewedAt: number): ReviewEventNode {
  return {
    id,
    reviewedAt,
    eventVersion: 1,
    payload: {
      reviewedAt,
      rating: 'good',
      elapsedDays: 1,
      scheduledDays: 1,
      stateBefore: 'new',
      stateAfter: 'review',
    },
    stamp: ts(reviewedAt),
  };
}

/** Minimal valid scheduler payload (all four required number fields). */
const VALID_PAYLOAD = {
  dueAt: 1000,
  intervalDays: 1,
  repetitions: 1,
  lapses: 0,
};

function baseWordNode(extra: Partial<WordNode> = {}): WordNode {
  return {
    normalized: '你好',
    createdAt: { value: 10, stamp: ts(10) },
    fields: {
      id: { value: 'w1', stamp: ts(20) },
      text: { value: '你好', stamp: ts(20) },
      note: { value: '', stamp: ts(20) },
      status: { value: 'inbox', stamp: ts(20) },
      pinyin: { value: null, stamp: ts(20) },
      traditionalText: { value: null, stamp: ts(20) },
      aiInsight: { value: null, stamp: ts(20) },
      updatedAt: { value: 20, stamp: ts(20) },
    },
    occurrences: {},
    occurrenceTombstones: {},
    reviewEvents: {},
    snapshot: undefined,
    ...extra,
  };
}

function stateWithWord(node: WordNode): SyncState {
  return {
    ...EMPTY_SYNC_STATE,
    replicas: ['R'],
    words: { [wordKey(node.normalized)]: node },
  };
}

// ---------------------------------------------------------------------------
// Guard 1: rebuildReview — invalid snapshot payload must drop the review
// ---------------------------------------------------------------------------

describe('rebuildReview guard — invalid snapshot payload', () => {
  const eventId = 'evt1';
  const reviewEvent = makeReviewEvent(eventId, 500);

  function nodeWithPayload(payload: unknown): WordNode {
    const snap: SchedulerSnapshotNode = {
      payload,
      reviewEventId: eventId,
      stamp: ts(500),
    };
    return baseWordNode({
      reviewEvents: { [eventId]: reviewEvent },
      snapshot: snap,
    });
  }

  it('returns undefined when snapshot payload is null', () => {
    const node = nodeWithPayload(null);
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when snapshot payload is a string', () => {
    const node = nodeWithPayload('bad');
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when snapshot payload is an array', () => {
    const node = nodeWithPayload([1, 2, 3]);
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when snapshot payload is a number', () => {
    const node = nodeWithPayload(42);
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when snapshot payload is missing dueAt', () => {
    const node = nodeWithPayload({ intervalDays: 1, repetitions: 1, lapses: 0 });
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when snapshot payload is missing intervalDays', () => {
    const node = nodeWithPayload({ dueAt: 1000, repetitions: 1, lapses: 0 });
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when required fields are strings instead of numbers', () => {
    const node = nodeWithPayload({ dueAt: '1000', intervalDays: '1', repetitions: 1, lapses: 0 });
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('returns undefined when snapshot payload is an empty object', () => {
    const node = nodeWithPayload({});
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });

  it('materialises review correctly when snapshot payload is VALID', () => {
    const node = nodeWithPayload(VALID_PAYLOAD);
    const out = materialize(stateWithWord(node));
    const review = out.inbox.words[0].review;
    expect(review).toBeDefined();
    expect(review?.dueAt).toBe(1000);
    expect(review?.intervalDays).toBe(1);
    expect(review?.repetitions).toBe(1);
    expect(review?.lapses).toBe(0);
    // reviewLog should carry the single review event's payload
    expect(review?.reviewLog).toHaveLength(1);
    expect(review?.reviewLog?.[0].reviewedAt).toBe(500);
  });

  it('returns undefined when reviewEvents are present but snapshot is absent', () => {
    // Previously this returned `{ reviewLog }` missing all required scheduler fields.
    // After the guard it must return undefined.
    const node = baseWordNode({ reviewEvents: { [eventId]: reviewEvent }, snapshot: undefined });
    const out = materialize(stateWithWord(node));
    expect(out.inbox.words[0].review).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Guard 2: pickSnapshot — non-orphaned snapshot preferred over orphaned
// ---------------------------------------------------------------------------

describe('pickSnapshot orphan preference', () => {
  /** Build a WordNode carrying a snapshot pointing at eventId and having the
   *  given review event in its reviewEvents map. */
  function makeNode(
    snapshotEventId: string,
    ownEventId: string | null,
    snapshotStamp: number,
    reviewedAt: number,
  ): WordNode {
    const reviewEvents: Record<string, ReviewEventNode> = {};
    if (ownEventId !== null) {
      reviewEvents[ownEventId] = makeReviewEvent(ownEventId, reviewedAt);
    }
    const snap: SchedulerSnapshotNode = {
      payload: VALID_PAYLOAD,
      reviewEventId: snapshotEventId,
      stamp: ts(snapshotStamp),
    };
    return baseWordNode({ reviewEvents, snapshot: snap });
  }

  it('prefers snapshot A whose event exists in merged events over orphaned snapshot B', () => {
    // Node A: snapshot references evt-A which A contributes to the union.
    const nodeA = makeNode('evt-A', 'evt-A', 200, 200);
    // Node B: snapshot references evt-B which is NOT in any node's reviewEvents.
    const nodeB = makeNode('evt-B', null, 300, 0);

    const merged = mergeWordNodes(nodeA, nodeB);

    // After merge, evt-A exists in merged.reviewEvents; evt-B does not.
    expect(merged.reviewEvents['evt-A']).toBeDefined();
    expect(merged.reviewEvents['evt-B']).toBeUndefined();
    // The winning snapshot must be A's (non-orphaned).
    expect(merged.snapshot?.reviewEventId).toBe('evt-A');
  });

  it('also prefers non-orphaned when it comes from node B', () => {
    // Mirror of previous: B has the non-orphaned snapshot, A is orphaned.
    const nodeA = makeNode('evt-A', null, 100, 0);
    const nodeB = makeNode('evt-B', 'evt-B', 200, 200);

    const merged = mergeWordNodes(nodeA, nodeB);

    expect(merged.reviewEvents['evt-B']).toBeDefined();
    expect(merged.snapshot?.reviewEventId).toBe('evt-B');
  });

  it('falls back to reviewOrder when both snapshots are non-orphaned', () => {
    // Both nodes have their own event present; later reviewedAt should win.
    const nodeA = makeNode('evt-A', 'evt-A', 200, 100); // reviewedAt=100
    const nodeB = makeNode('evt-B', 'evt-B', 150, 200); // reviewedAt=200

    const merged = mergeWordNodes(nodeA, nodeB);

    // Both events survive the union.
    expect(merged.reviewEvents['evt-A']).toBeDefined();
    expect(merged.reviewEvents['evt-B']).toBeDefined();
    // Higher reviewedAt (evt-B) wins.
    expect(merged.snapshot?.reviewEventId).toBe('evt-B');
  });

  it('when both events are orphaned, stamp tie-breaks', () => {
    // Neither node contributes its snapshot's event to reviewEvents.
    const nodeA = makeNode('evt-A', null, 100, 0);
    const nodeB = makeNode('evt-B', null, 200, 0); // higher stamp

    const merged = mergeWordNodes(nodeA, nodeB);

    expect(merged.reviewEvents['evt-A']).toBeUndefined();
    expect(merged.reviewEvents['evt-B']).toBeUndefined();
    // Both are equally orphaned; stamp tie-break picks higher stamp = evt-B.
    expect(merged.snapshot?.reviewEventId).toBe('evt-B');
  });
});
