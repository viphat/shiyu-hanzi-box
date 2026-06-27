// @vitest-environment happy-dom

// End-to-end coverage for useInbox.mutateWithRemovals — the seam the dashboard
// tag write paths (setQuoteTags / renameTagEverywhere / deleteTagEverywhere)
// route through. It must, from a SINGLE freshly-read snapshot, fire the batched
// `removeTags` tombstone AND write the updated inbox without the inbox write
// wiping that tombstone. A split snapshot or wrong ordering here silently
// resurrects removed tags, so this guards the exact regression-prone path.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useInbox } from '../../entrypoints/dashboard/hooks/useInbox';
import { registerSyncMutationHandler } from '../../entrypoints/background/sync-mutation-handler';
import { syncMetadataStorage } from '../../lib/sync/mutations';
import { getInbox, setInbox } from '../../lib/storage';
import type { Inbox, QuoteEntry } from '../../lib/types';

function quote(tags: string[]): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: 'hi',
    note: '',
    status: 'inbox',
    tags,
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
  };
}

let container: HTMLDivElement;
let root: Root;
let captured: ReturnType<typeof useInbox>;

function Harness() {
  captured = useInbox();
  return null;
}

beforeEach(async () => {
  fakeBrowser.reset();
  registerSyncMutationHandler();
  await setInbox({ words: [], quotes: [quote(['a', 'b'])] });
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(<Harness />);
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe('useInbox.mutateWithRemovals', () => {
  it('fires removeTags and writes the inbox; the tombstone survives the write', async () => {
    await act(async () => {
      await captured.mutateWithRemovals((current: Inbox) => ({
        removals: [{ quoteId: 'q1', tags: ['a'] }],
        inbox: {
          ...current,
          quotes: current.quotes.map((q) => (q.id === 'q1' ? { ...q, tags: ['b'] } : q)),
        },
      }));
    });

    // Inbox write landed.
    expect((await getInbox()).quotes[0].tags).toEqual(['b']);
    // removeTags tombstone was recorded AND not wiped by the subsequent inbox write.
    const meta = await syncMetadataStorage.getValue();
    expect(meta.state?.quotes.q1.tagTombstones?.a).toBeDefined();
  });

  it('skips both mutations when the planner returns null', async () => {
    const before = await syncMetadataStorage.getValue();
    await act(async () => {
      await captured.mutateWithRemovals(() => null);
    });
    expect(await syncMetadataStorage.getValue()).toEqual(before);
    expect((await getInbox()).quotes[0].tags).toEqual(['a', 'b']);
  });
});
