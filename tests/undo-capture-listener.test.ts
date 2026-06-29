import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { saveQuote } from '../lib/capture';
import { getInbox } from '../lib/storage';
import { registerUndoCaptureListener } from '../entrypoints/background/index';

beforeEach(() => fakeBrowser.reset());

describe('undo-capture listener', () => {
  it('reverses a created quote and acks { ok: true }', async () => {
    registerUndoCaptureListener();
    const outcome = await saveQuote('学而时习之', {
      sourceTitle: 'P', sourceUrl: 'u', sourceDomain: 'd', surrounding: '', capturedAt: 1,
    });
    const ack = await fakeBrowser.runtime.sendMessage({
      type: 'undo-capture', kind: 'quote', action: 'created', entryId: outcome!.entry.id,
    });
    expect(ack).toEqual({ ok: true });
    expect((await getInbox()).quotes).toHaveLength(0);
  });

  it('ignores unrelated messages', async () => {
    registerUndoCaptureListener();
    const ack = await fakeBrowser.runtime.sendMessage({ type: 'something-else' });
    expect(ack).toBeUndefined();
  });
});
