import { buildIndex } from '@/lib/dictionary';
import { createKaikkiJsonlStreamParser, hashKaikkiEntries } from '@/lib/kaikki';
import { setKaikkiCache } from '@/lib/kaikki-cache';
import type {
  KaikkiImportProgress,
  KaikkiImportWorkerRequest,
  KaikkiImportWorkerResponse,
} from './kaikki-import-types';

let cancelled = false;

function post(message: KaikkiImportWorkerResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<KaikkiImportWorkerRequest>) => {
  const message = event.data;
  if (message.type === 'cancel') {
    cancelled = true;
    return;
  }

  cancelled = false;
  importFile(message.file).catch(() => {
    if (!cancelled) post({ type: 'error', message: 'Import failed.' });
  });
};

async function importFile(file: File) {
  const parser = createKaikkiJsonlStreamParser();
  const reader = file.stream().getReader();
  const decoder = new TextDecoder();
  const totalBytes = file.size;
  let loadedBytes = 0;
  let lastProgressAt = 0;

  try {
    while (true) {
      if (cancelled) {
        await reader.cancel();
        post({ type: 'cancelled' });
        return;
      }

      const { value, done } = await reader.read();
      if (done) break;
      loadedBytes += value.byteLength;
      parser.addChunk(decoder.decode(value, { stream: true }));

      const now = Date.now();
      if (now - lastProgressAt > 100) {
        post({ type: 'progress', ...progress(parser.snapshot(), loadedBytes, totalBytes) });
        lastProgressAt = now;
      }
    }

    const tail = decoder.decode();
    if (tail) parser.addChunk(tail);
    const parsed = parser.finish();
    const finalProgress = progress(
      { entryCount: parsed.entries.length, skipped: parsed.skipped },
      totalBytes,
      totalBytes,
    );
    post({ type: 'writing', ...finalProgress });

    if (cancelled) {
      post({ type: 'cancelled' });
      return;
    }
    if (parsed.entries.length === 0) {
      post({ type: 'error', message: 'No usable Chinese entries found.' });
      return;
    }

    const hash = hashKaikkiEntries(parsed.entries);
    await setKaikkiCache(hash, buildIndex(parsed.entries));
    post({
      type: 'complete',
      hash,
      entryCount: parsed.entries.length,
      skipped: parsed.skipped,
    });
  } finally {
    reader.releaseLock();
  }
}

function progress(
  snapshot: { entryCount: number; skipped: number },
  loadedBytes: number,
  totalBytes: number,
): KaikkiImportProgress {
  return {
    loadedBytes,
    totalBytes,
    percent: totalBytes > 0 ? Math.min(100, Math.round((loadedBytes / totalBytes) * 100)) : 0,
    entryCount: snapshot.entryCount,
    skipped: snapshot.skipped,
  };
}
