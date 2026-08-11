import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getInbox, inboxStorage, mutateInbox } from '../lib/storage';
import type { WordEntry } from '../lib/types';

beforeEach(() => {
  fakeBrowser.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function word(id: string): WordEntry {
  return {
    id,
    kind: 'word',
    text: id,
    normalized: id,
    note: '',
    status: 'inbox',
    createdAt: 1,
    updatedAt: 1,
    occurrences: [],
  };
}

/**
 * `mutateInbox` serialises writes through a single module-level promise. A
 * rejection anywhere in that chain must not leak into the next mutation —
 * otherwise the background page silently drops every write until reloaded.
 */
describe('mutateInbox failure isolation', () => {
  it('surfaces a throwing mutator to its own caller only', async () => {
    await expect(
      mutateInbox(() => {
        throw new Error('mutator boom');
      }),
    ).rejects.toThrow('mutator boom');

    const after = await mutateInbox((inbox) => ({ ...inbox, words: [word('a')] }));
    expect(after.words.map((w) => w.id)).toEqual(['a']);
    expect((await getInbox()).words.map((w) => w.id)).toEqual(['a']);
  });

  it('recovers after the underlying write rejects', async () => {
    const setValue = vi
      .spyOn(inboxStorage, 'setValue')
      .mockRejectedValueOnce(new Error('QUOTA_BYTES quota exceeded'));

    await expect(mutateInbox((inbox) => ({ ...inbox, words: [word('b')] }))).rejects.toThrow(
      'quota exceeded',
    );
    expect(setValue).toHaveBeenCalledTimes(1);

    const after = await mutateInbox((inbox) => ({ ...inbox, words: [...inbox.words, word('c')] }));
    expect(after.words.map((w) => w.id)).toEqual(['c']);
    expect((await getInbox()).words.map((w) => w.id)).toEqual(['c']);
  });
});

describe('mutateInbox durability', () => {
  it('resolves only once the returned value is persisted', async () => {
    const real = inboxStorage.setValue.bind(inboxStorage);
    vi.spyOn(inboxStorage, 'setValue').mockImplementation(async (next) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await real(next);
    });

    const returned = await mutateInbox((inbox) => ({ ...inbox, words: [word('d')] }));
    const stored = await getInbox();

    expect(returned.words.map((w) => w.id)).toEqual(['d']);
    expect(stored.words.map((w) => w.id)).toEqual(['d']);
  });
});
