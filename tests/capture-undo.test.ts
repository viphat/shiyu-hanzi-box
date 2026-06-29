import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { undoCapture } from '../entrypoints/background/capture-undo';
import { registerSyncMutationHandler } from '../entrypoints/background/sync-mutation-handler';
import { saveWord, saveQuote } from '../lib/capture';
import { legacyOccurrenceId } from '../lib/sync/project';
import { getInbox } from '../lib/storage';
import { syncMetadataStorage } from '../lib/sync/mutations';

const SRC = {
  sourceTitle: 'Page', sourceUrl: 'https://example.com/a',
  sourceDomain: 'example.com', surrounding: 'ctx', capturedAt: 1000,
};

beforeEach(() => {
  fakeBrowser.reset();
  registerSyncMutationHandler();
});

describe('undoCapture', () => {
  it('created quote → removes from inbox and tombstones quote:<id>', async () => {
    const outcome = await saveQuote('学而时习之', SRC);
    const id = outcome!.entry.id;
    await undoCapture({ type: 'undo-capture', kind: 'quote', action: 'created', entryId: id });
    expect((await getInbox()).quotes).toHaveLength(0);
    expect((await syncMetadataStorage.getValue()).state!.tombstones[`quote:${id}`]).toBeDefined();
  });

  it('created word → removes from inbox and tombstones word:<normalized>', async () => {
    const outcome = await saveWord('你好', SRC);
    await undoCapture({
      type: 'undo-capture', kind: 'word', action: 'created',
      entryId: outcome!.entry.id, normalized: '你好',
    });
    expect((await getInbox()).words).toHaveLength(0);
    expect((await syncMetadataStorage.getValue()).state!.tombstones['word:你好']).toBeDefined();
  });

  it('occurrence-added → removes the occurrence and writes its tombstone', async () => {
    await saveWord('你好', SRC);
    const outcome = await saveWord('你好', { ...SRC, sourceUrl: 'https://example.com/b', capturedAt: 2000 });
    const wordId = outcome!.entry.id;
    const occ = { sourceUrl: 'https://example.com/b', surrounding: 'ctx', capturedAt: 2000 };
    await undoCapture({
      type: 'undo-capture', kind: 'word', action: 'occurrence-added',
      entryId: wordId, normalized: '你好', occurrence: occ,
    });
    const inbox = await getInbox();
    expect(inbox.words[0].occurrences).toHaveLength(1);
    const occId = legacyOccurrenceId(wordId, { sourceTitle: '', sourceDomain: '', ...occ });
    expect((await syncMetadataStorage.getValue()).state!.words['word:你好'].occurrenceTombstones[occId]).toBeDefined();
  });

  it('is a no-op when the entry is already gone', async () => {
    await undoCapture({ type: 'undo-capture', kind: 'quote', action: 'created', entryId: 'missing' });
    expect((await getInbox()).quotes).toHaveLength(0);
  });
});
