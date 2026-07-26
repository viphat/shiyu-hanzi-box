export type CvdictInstallWorkerRequest =
  | { type: 'install' }
  | { type: 'cancel' };

export type CvdictInstallWorkerResponse =
  | {
      type: 'progress';
      loadedBytes: number;
      totalBytes: number | null;
      entryCount: number;
      skipped: number;
    }
  | { type: 'indexing'; entryCount: number; skipped: number }
  | {
      type: 'complete';
      hash: string;
      entryCount: number;
      version: string;
      release: string;
    }
  | { type: 'cancelled' }
  | { type: 'error'; code: 'network' | 'http' | 'too-large' | 'invalid-data' };
