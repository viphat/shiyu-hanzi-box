// @vitest-environment happy-dom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DriftView } from '../entrypoints/dashboard/components/DriftView';
import { driftKey, EMPTY_DRIFT_STORE, MAX_DRIFT_LEVEL, type DriftStore } from '../lib/drift';
import { messages } from '../lib/i18n';
import type { Inbox, QuoteEntry, WordEntry } from '../lib/types';

const NOW = new Date('2026-08-11T10:00:00').getTime();

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
    tags: ['论语'],
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    sourceTitle: 'Analects',
    sourceUrl: 'https://example.com/a',
    sourceDomain: 'example.com',
    surrounding: '',
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function render(inbox: Inbox, handlers: Record<string, unknown> = {}) {
  act(() => {
    root.render(
      <DriftView
        inbox={inbox}
        store={EMPTY_DRIFT_STORE}
        onThumb={() => {}}
        onSkip={() => {}}
        onBack={() => {}}
        locale="en"
        random={() => 0}
        now={() => NOW}
        {...handlers}
      />,
    );
  });
}

function click(testId: string) {
  act(() => {
    container
      .querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('DriftView', () => {
  it('shows the empty state when nothing is collectable', () => {
    render({ words: [], quotes: [] });
    expect(container.textContent).toContain(messages.en['drift.emptyTitle']);
  });

  it('excludes archived entries from the pool', () => {
    render({ words: [word({ status: 'archived' })], quotes: [] });
    expect(container.textContent).toContain(messages.en['drift.emptyTitle']);
  });

  it('shows a parked quote, which SRS can never surface', () => {
    render({ words: [], quotes: [quote({ clozes: [] })] });
    expect(container.textContent).toContain('学而时习之');
  });

  it('renders a quote with no cloze blanks', () => {
    render({
      words: [],
      quotes: [quote({ clozes: [{ id: 'c1', start: 0, end: 2 }] })],
    });
    // The full sentence, not a blanked one.
    expect(container.textContent).toContain('学而时习之');
    expect(container.textContent).not.toContain('____');
  });

  it('offers all three controls plus back', () => {
    render({ words: [word()], quotes: [] });
    for (const id of ['drift-down', 'drift-skip', 'drift-up']) {
      expect(container.querySelector(`[data-testid="${id}"]`)).not.toBeNull();
    }
  });

  it('reports a thumb-up with its previous level and local day', () => {
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onThumb });
    click('drift-up');
    expect(onThumb).toHaveBeenCalledWith(
      expect.objectContaining({ normalized: '你好' }),
      1,
      0,
      '2026-08-11',
    );
  });

  it('reports a thumb-down as delta -1', () => {
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onThumb });
    click('drift-down');
    expect(onThumb).toHaveBeenCalledWith(expect.anything(), -1, 0, '2026-08-11');
  });

  it('records a skip without a weight change', () => {
    const onSkip = vi.fn();
    const onThumb = vi.fn();
    render({ words: [word()], quotes: [] }, { onSkip, onThumb });
    click('drift-skip');
    expect(onSkip).toHaveBeenCalledWith('2026-08-11');
    expect(onThumb).not.toHaveBeenCalled();
  });

  it('advances to a different card after a thumb', () => {
    // Distinct text per word — two entries both reading 你好 would make this
    // assertion pass or fail for the wrong reason.
    render({ words: [word({ id: 'wa', normalized: 'a', text: '甲' }), word({ id: 'wb', normalized: 'b', text: '乙' })], quotes: [] });
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('甲');
    click('drift-up');
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('乙');
  });

  it('hides Back on the first card', () => {
    render({ words: [word()], quotes: [] });
    expect(container.querySelector('[data-testid="drift-back"]')).toBeNull();
  });

  it('returns to the previous card and reports the level to restore', () => {
    const onBack = vi.fn();
    render(
      { words: [word({ id: 'wa', normalized: 'a', text: '甲' }), word({ id: 'wb', normalized: 'b', text: '乙' })], quotes: [] },
      { onBack },
    );
    click('drift-up');
    click('drift-back');
    expect(container.querySelector('[data-testid="drift-text"]')!.textContent).toBe('甲');
    expect(onBack).toHaveBeenCalledWith(expect.anything(), 0, '2026-08-11');
  });

  it('renders a five-dot weight scale', () => {
    render({ words: [word()], quotes: [] });
    expect(container.querySelectorAll('[data-testid="drift-dot"]')).toHaveLength(5);
  });

  it('restores the exact no-repeat window across Backs that cross an eviction', () => {
    // Regression test for the `recent` ring/history desync: `recent` is a
    // capped sliding window, not a growing stack, so once it starts
    // evicting, undoing by popping its last element (the pre-fix `back()`)
    // can never recover an evicted key.
    //
    // A *single* Back can't expose this by itself: redoing the exact action
    // that was undone re-appends the same key that was just discarded, and
    // slicing back down to the window size collapses the buggy and correct
    // `recent` arrays to the same result either way (that key was always
    // going to be evicted again). Two Backs break that symmetry — the
    // second one lands on a redo of a *different* key, so the desync
    // becomes observable in which card gets drawn next.
    const words = [
      word({ id: 'wa', normalized: 'a', text: '甲' }),
      word({ id: 'wb', normalized: 'b', text: '乙' }),
      word({ id: 'wc', normalized: 'c', text: '丙' }),
      word({ id: 'wd', normalized: 'd', text: '丁' }),
    ];
    render({ words, quotes: [] });
    const text = () => container.querySelector('[data-testid="drift-text"]')!.textContent;

    // Pool is sorted by driftKey ('word:a' < 'word:b' < ...), and `random`
    // is pinned to 0, so `pickDriftCard` deterministically walks the pool
    // in order, skipping whatever the no-repeat window blocks.
    expect(text()).toBe('甲');
    click('drift-up'); // 甲 -> 乙
    expect(text()).toBe('乙');
    click('drift-up'); // 乙 -> 丙
    expect(text()).toBe('丙');
    click('drift-up'); // 丙 -> 甲 (pool size 4 -> window size 2: this advance evicts 甲's key)
    expect(text()).toBe('甲');

    click('drift-back'); // undo the 丙 advance
    expect(text()).toBe('丙');
    click('drift-back'); // undo the 乙 advance
    expect(text()).toBe('乙');

    // Correctly restored, the window still holds both 甲 and 乙 (exactly as
    // it did the first time we stood on 乙), so the next draw must skip
    // both and land on 丙 — reproducing the original run. The pre-fix
    // version has already lost 甲 from the window by this point and wrongly
    // redraws it instead.
    click('drift-up');
    expect(text()).toBe('丙');
  });

  it('reports the clamped level, not an off-by-one, when Back undoes a no-op at the max bound', () => {
    // All the other tests render with EMPTY_DRIFT_STORE, so `previousLevel`
    // is always 0 and this never gets exercised: thumbing up an entry
    // already at MAX_DRIFT_LEVEL is a clamped no-op, and Back must report
    // the bound level it actually was (2), not compute `level - delta` and
    // land one step off it (1). This is the exact case `previousLevel`
    // exists to handle.
    const words = [word({ normalized: 'a', text: '甲' })];
    const store: DriftStore = { weights: { [driftKey(words[0])]: MAX_DRIFT_LEVEL }, days: {} };
    const onBack = vi.fn();
    render({ words, quotes: [] }, { store, onBack });

    click('drift-up'); // clamped no-op: already at MAX_DRIFT_LEVEL
    click('drift-back');

    expect(onBack).toHaveBeenCalledWith(expect.anything(), MAX_DRIFT_LEVEL, '2026-08-11');
  });

  it('skips a history entry archived elsewhere and lands on the most recent surviving one', () => {
    // Regression test for Back landing on a card no longer in the pool. The
    // *display* already tolerates this by falling back to pool[0] (see
    // `active` in DriftView), which is exactly what makes the pre-fix bug
    // easy to miss: with only one archived history entry, pool[0] can
    // coincidentally *be* the right answer. This test picks entries so
    // pool[0] after the archive is a *different* card than the correct
    // restore target, so a pre-fix `back()` would visibly show the wrong
    // card, call onBack with the wrong entry, and report the wrong
    // previousLevel.
    const words = [
      word({ id: 'wa', normalized: 'a', text: '甲' }),
      word({ id: 'wb', normalized: 'b', text: '乙' }),
      word({ id: 'wc', normalized: 'c', text: '丙' }),
      word({ id: 'wd', normalized: 'd', text: '丁' }),
    ];
    // Distinct levels per entry so the asserted previousLevel below can only
    // match the entry `back()` is actually supposed to land on.
    const store: DriftStore = {
      weights: { 'word:a': 1, 'word:b': -1, 'word:c': 2 },
      days: {},
    };
    const onBack = vi.fn();
    const text = () => container.querySelector('[data-testid="drift-text"]')!.textContent;

    render({ words, quotes: [] }, { store, onBack });

    // Pool is sorted by driftKey ('word:a' < ... < 'word:d') and `random` is
    // pinned to 0, so this walks deterministically: 甲 -> 乙 -> 丙 (window
    // size 2 for a 4-card pool), pushing all three onto the history stack in
    // that order, 丙 on top.
    expect(text()).toBe('甲');
    click('drift-up');
    expect(text()).toBe('乙');
    click('drift-up');
    expect(text()).toBe('丙');
    click('drift-up');

    // 丙 (the top of the history stack) is archived in "another tab": drop it
    // from the pool by re-rendering with updated inbox, on the same root, so
    // DriftView's internal history/recent state carries over exactly as a
    // real prop update would leave it.
    const wc = words[2];
    act(() => {
      root.render(
        <DriftView
          inbox={{ words: [words[0], words[1], { ...wc, status: 'archived' }, words[3]], quotes: [] }}
          store={store}
          onThumb={() => {}}
          onSkip={() => {}}
          onBack={onBack}
          locale="en"
          random={() => 0}
          now={() => NOW}
        />,
      );
    });

    click('drift-back');

    // Lands on 乙 (previousLevel -1), skipping over the archived 丙
    // (previousLevel 2) entirely — not the pool-order fallback 甲 that a
    // pre-fix back() would show (丙's own driftKey lookup misses, pool[0] is
    // 甲, and 甲 ≠ 乙 is exactly the divergence this test is built to catch).
    expect(text()).toBe('乙');
    expect(onBack).toHaveBeenCalledWith(expect.objectContaining({ normalized: 'b' }), -1, '2026-08-11');
    expect(onBack).not.toHaveBeenCalledWith(expect.objectContaining({ normalized: 'c' }), expect.anything(), expect.anything());

    // The archived 丙 frame and the now-consumed 乙 frame must both be gone
    // from history — a second Back should skip straight to 甲, not re-surface
    // either of them.
    click('drift-back');
    expect(text()).toBe('甲');
    expect(onBack).toHaveBeenCalledWith(expect.objectContaining({ normalized: 'a' }), 1, '2026-08-11');
  });
});
