// @vitest-environment happy-dom

// The dashboard cloze write path (entrypoints/dashboard/App.tsx updateQuote)
// routes through useInbox.mutateWithRemovals so the `removeClozes` tombstones
// and the inbox write are planned from ONE freshly-read snapshot, in that
// order. Removing a blank is not representable as absence in the synced OR-Set,
// so a missing or mis-ordered tombstone silently resurrects the blank on the
// next sync pass.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useInbox } from '../../entrypoints/dashboard/hooks/useInbox';
import { registerSyncMutationHandler } from '../../entrypoints/background/sync-mutation-handler';
import { syncMetadataStorage } from '../../lib/sync/mutations';
import { planClozeWrite } from '../../lib/cloze';
import { getInbox, setInbox } from '../../lib/storage';
import type { Cloze, Inbox, QuoteEntry } from '../../lib/types';

function quote(clozes: Cloze[]): QuoteEntry {
  return {
    id: 'q1',
    kind: 'quote',
    text: '天行健',
    note: '',
    status: 'inbox',
    tags: [],
    createdAt: 10,
    updatedAt: 20,
    sourceTitle: '',
    sourceUrl: '',
    sourceDomain: '',
    surrounding: '',
    clozes,
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
  await setInbox({
    words: [],
    quotes: [quote([{ id: 'a', start: 0, end: 1 }, { id: 'b', start: 1, end: 2 }])],
  });
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

describe('useInbox.mutateWithRemovals (clozes)', () => {
  it('fires removeClozes and writes the inbox; the tombstone survives the write', async () => {
    await act(async () => {
      await captured.mutateWithRemovals((current: Inbox) => {
        const target = current.quotes[0];
        const next = (target.clozes ?? []).filter((c) => c.id !== 'a');
        return {
          clozeRemovals: [{ quoteId: 'q1', clozeIds: planClozeWrite(target.clozes, next) }],
          inbox: {
            ...current,
            quotes: current.quotes.map((q) => (q.id === 'q1' ? { ...q, clozes: next } : q)),
          },
        };
      });
    });

    expect((await getInbox()).quotes[0].clozes?.map((c) => c.id)).toEqual(['b']);
    const meta = await syncMetadataStorage.getValue();
    expect(meta.state?.quotes.q1.clozeTombstones?.a).toBeDefined();
    expect(meta.state?.quotes.q1.clozeTombstones?.b).toBeUndefined();
  });
});
