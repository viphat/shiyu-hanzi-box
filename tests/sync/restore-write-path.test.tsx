// @vitest-environment happy-dom

// Restoring a JSON backup replaces the whole inbox through useInbox.replace.
// Tags, cloze blanks and occurrences the backup does not carry are gone from
// the domain, but absence is not removal in an add-wins OR-Set — without
// tombstones the next pass materializes them straight back and the restore
// silently fails to stick.
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useInbox } from '../../entrypoints/dashboard/hooks/useInbox';
import { registerSyncMutationHandler } from '../../entrypoints/background/sync-mutation-handler';
import { syncMetadataStorage } from '../../lib/sync/mutations';
import { legacyOccurrenceId, wordKey } from '../../lib/sync/project';
import { getInbox, setInbox } from '../../lib/storage';
import type { Cloze, Inbox, Occurrence, QuoteEntry, WordEntry } from '../../lib/types';

const occ = (capturedAt: number): Occurrence => ({
  sourceTitle: 't',
  sourceUrl: 'https://example.com',
  sourceDomain: 'example.com',
  surrounding: 's',
  capturedAt,
});

function quote(over: Partial<QuoteEntry> = {}): QuoteEntry {
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
    ...over,
  };
}

function word(occurrences: Occurrence[]): WordEntry {
  return {
    id: 'w1',
    kind: 'word',
    text: '你好',
    normalized: '你好',
    note: '',
    status: 'inbox',
    createdAt: 10,
    updatedAt: 20,
    occurrences,
  };
}

const BLANKS: Cloze[] = [
  { id: 'a', start: 0, end: 1 },
  { id: 'b', start: 1, end: 2 },
];

let container: HTMLDivElement;
let root: Root;
let captured: ReturnType<typeof useInbox>;

function Harness() {
  captured = useInbox();
  return null;
}

async function restore(next: Inbox) {
  await act(async () => {
    await captured.replace(next);
  });
}

beforeEach(async () => {
  fakeBrowser.reset();
  registerSyncMutationHandler();
  await setInbox({
    words: [word([occ(100), occ(200)])],
    quotes: [quote({ tags: ['keep', 'drop'], clozes: BLANKS })],
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

describe('useInbox.replace (backup restore)', () => {
  it('tombstones the tags, blanks and occurrences the backup dropped', async () => {
    await restore({
      words: [word([occ(100)])],
      quotes: [quote({ tags: ['keep'], clozes: [BLANKS[0]] })],
    });

    // The inbox write landed.
    const inbox = await getInbox();
    expect(inbox.quotes[0].tags).toEqual(['keep']);
    expect(inbox.quotes[0].clozes?.map((c) => c.id)).toEqual(['a']);
    expect(inbox.words[0].occurrences).toHaveLength(1);

    // ...and none of the three tombstones were wiped by that write.
    const state = (await syncMetadataStorage.getValue()).state;
    expect(state?.quotes.q1.tagTombstones?.drop).toBeDefined();
    expect(state?.quotes.q1.tagTombstones?.keep).toBeUndefined();
    expect(state?.quotes.q1.clozeTombstones?.b).toBeDefined();
    expect(state?.quotes.q1.clozeTombstones?.a).toBeUndefined();
    const dropped = legacyOccurrenceId('w1', occ(200));
    const kept = legacyOccurrenceId('w1', occ(100));
    expect(state?.words[wordKey('你好')].occurrenceTombstones?.[dropped]).toBeDefined();
    expect(state?.words[wordKey('你好')].occurrenceTombstones?.[kept]).toBeUndefined();
  });

  it('records nothing when the restore keeps everything', async () => {
    await restore({
      words: [word([occ(100), occ(200)])],
      quotes: [quote({ tags: ['keep', 'drop'], clozes: BLANKS })],
    });

    const state = (await syncMetadataStorage.getValue()).state;
    expect(state?.quotes.q1?.tagTombstones ?? {}).toEqual({});
    expect(state?.quotes.q1?.clozeTombstones ?? {}).toEqual({});
    expect(state?.words[wordKey('你好')]?.occurrenceTombstones ?? {}).toEqual({});
  });
});
