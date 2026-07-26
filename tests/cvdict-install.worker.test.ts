import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_CVDICT_DOWNLOAD_BYTES } from '../lib/cvdict';
import { setCvdictCache } from '../lib/cvdict-cache';

vi.mock('../lib/cvdict-cache', () => ({
  setCvdictCache: vi.fn(),
}));

interface WorkerScope {
  postMessage(message: unknown): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
}

let posted: unknown[];
let workerScope: WorkerScope;

beforeEach(() => {
  vi.resetModules();
  vi.mocked(setCvdictCache).mockReset();
  posted = [];
  workerScope = {
    postMessage(message) {
      posted.push(message);
    },
    onmessage: null,
  };
  vi.stubGlobal('self', workerScope);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('CVDICT install worker', () => {
  it('writes only a complete valid parsed index', async () => {
    await runInstallWorker(validCvdictResponse());

    await vi.waitFor(() => {
      expect(setCvdictCache).toHaveBeenCalledWith('b74bf37a', expect.anything());
      expect(posted.at(-1)).toMatchObject({
        type: 'complete',
        entryCount: 2,
        version: '1.0.1',
        release: '2024-12-02T17:46:19Z',
      });
    });
  });

  it('does not write a cache entry for an oversized response', async () => {
    await runInstallWorker(responseLargerThan(MAX_CVDICT_DOWNLOAD_BYTES));

    await vi.waitFor(() => {
      expect(setCvdictCache).not.toHaveBeenCalled();
      expect(posted.at(-1)).toEqual({ type: 'error', code: 'too-large' });
    });
  });
});

async function runInstallWorker(response: Response): Promise<void> {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
  await import('../entrypoints/settings/cvdict-install.worker');
  workerScope.onmessage?.({ data: { type: 'install' } } as MessageEvent<unknown>);
}

function validCvdictResponse(): Response {
  return new Response(
    '#! version=1.0.1\n#! date=2024-12-02T17:46:19Z\n你好 你好 [ni3 hao3] /xin chào/\n學習 学习 [xue2 xi2] /học tập/\n',
  );
}

function responseLargerThan(byteLength: number): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(byteLength + 1));
      controller.close();
    },
  }));
}
