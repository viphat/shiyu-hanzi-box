export interface KaikkiImportProgress {
  loadedBytes: number;
  totalBytes: number;
  percent: number;
  entryCount: number;
  skipped: number;
}

export type KaikkiImportWorkerRequest =
  | { type: 'import'; file: File }
  | { type: 'cancel' };

export type KaikkiImportWorkerResponse =
  | ({ type: 'progress' } & KaikkiImportProgress)
  | ({ type: 'writing' } & KaikkiImportProgress)
  | {
      type: 'complete';
      hash: string;
      entryCount: number;
      skipped: number;
    }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };
