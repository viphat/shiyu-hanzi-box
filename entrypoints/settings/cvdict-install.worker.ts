import { buildIndex, createCedictStreamParser } from '@/lib/dictionary';
import {
  CVDICT_SOURCE_URL,
  hashDictionaryEntries,
  isCvdictResultValid,
  isCvdictSizeAllowed,
} from '@/lib/cvdict';
import { setCvdictCache } from '@/lib/cvdict-cache';
import type {
  CvdictInstallWorkerRequest,
  CvdictInstallWorkerResponse,
} from './cvdict-install-types';

let cancelled = false;
let requestController: AbortController | null = null;

function post(message: CvdictInstallWorkerResponse) {
  self.postMessage(message);
}

self.onmessage = (event: MessageEvent<CvdictInstallWorkerRequest>) => {
  if (event.data.type === 'cancel') {
    cancelled = true;
    requestController?.abort();
    return;
  }

  cancelled = false;
  installCvdict().catch(() => {
    if (cancelled) post({ type: 'cancelled' });
    else post({ type: 'error', code: 'invalid-data' });
  });
};

async function installCvdict() {
  const controller = new AbortController();
  requestController = controller;
  let response: Response;

  try {
    response = await fetch(CVDICT_SOURCE_URL, { signal: controller.signal });
  } catch {
    if (cancelled) post({ type: 'cancelled' });
    else post({ type: 'error', code: 'network' });
    return;
  } finally {
    if (requestController === controller && cancelled) requestController = null;
  }

  if (cancelled) {
    post({ type: 'cancelled' });
    return;
  }
  if (!response.ok) {
    post({ type: 'error', code: 'http' });
    return;
  }
  if (!response.body) {
    post({ type: 'error', code: 'invalid-data' });
    return;
  }

  const contentLength = parseContentLength(response.headers.get('content-length'));
  if (contentLength !== null && !isCvdictSizeAllowed(contentLength)) {
    post({ type: 'error', code: 'too-large' });
    return;
  }

  const parser = createCedictStreamParser();
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
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
      if (!isCvdictSizeAllowed(loadedBytes)) {
        await reader.cancel();
        post({ type: 'error', code: 'too-large' });
        return;
      }

      parser.addChunk(decoder.decode(value, { stream: true }));
      const now = Date.now();
      if (now - lastProgressAt > 100) {
        post({ type: 'progress', ...progress(parser.snapshot(), loadedBytes, contentLength) });
        lastProgressAt = now;
      }
    }

    const tail = decoder.decode();
    if (tail) parser.addChunk(tail);
    const parsed = parser.finish();
    if (cancelled) {
      post({ type: 'cancelled' });
      return;
    }
    if (!isCvdictResultValid(parsed)) {
      post({ type: 'error', code: 'invalid-data' });
      return;
    }

    post({ type: 'indexing', entryCount: parsed.entries.length, skipped: parsed.skipped });
    const entries = parsed.entries.map((entry, index) => ({ ...entry, index }));
    const hash = hashDictionaryEntries(entries);
    await setCvdictCache(hash, buildIndex(entries));
    if (cancelled) {
      post({ type: 'cancelled' });
      return;
    }

    post({
      type: 'complete',
      hash,
      entryCount: parsed.entries.length,
      version: parsed.metadata.version!,
      release: parsed.metadata.release!,
    });
  } finally {
    reader.releaseLock();
    if (requestController === controller) requestController = null;
  }
}

function parseContentLength(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function progress(
  snapshot: { entryCount: number; skipped: number },
  loadedBytes: number,
  totalBytes: number | null,
) {
  return {
    loadedBytes,
    totalBytes,
    entryCount: snapshot.entryCount,
    skipped: snapshot.skipped,
  };
}
