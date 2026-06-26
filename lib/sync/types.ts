import type { Status } from '../types';

export const APP_ID = 'shiyu-hanzi-box' as const;
export const SYNC_FORMAT_VERSION = 1 as const;
export const VAULT_FORMAT_VERSION = 1 as const;

export interface HybridTimestamp {
  wallTime: number;
  counter: number;
  replicaId: string;
}

export interface Register<T> {
  value: T;
  stamp: HybridTimestamp;
}

/** Occurrence value as projected into sync state (mirrors lib/types Occurrence). */
export interface OccurrenceNode {
  id: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceDomain: string;
  surrounding: string;
  capturedAt: number;
  stamp: HybridTimestamp;
}

/** One review event, unioned by stable id. */
export interface ReviewEventNode {
  id: string;
  reviewedAt: number;
  eventVersion: number;
  /** Opaque persisted ReviewLogEntry payload; merge never interprets it. */
  payload: unknown;
  stamp: HybridTimestamp;
}

/** Scheduler snapshot fields that move together, tied to the winning review. */
export interface SchedulerSnapshotNode {
  /** Opaque persisted scheduler subset of ReviewState (no queueRank). */
  payload: unknown;
  /** Id of the review event this snapshot belongs to. */
  reviewEventId: string;
  stamp: HybridTimestamp;
}

export interface WordNode {
  /** Logical key value: normalized text. */
  normalized: string;
  /** Canonical public id chosen by earliest createdAt then smallest id. */
  fields: Record<string, Register<unknown>>;
  createdAt: Register<number>;
  occurrences: Record<string, OccurrenceNode>;
  occurrenceTombstones: Record<string, HybridTimestamp>;
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}

export interface QuoteNode {
  id: string;
  fields: Record<string, Register<unknown>>;
  createdAt: Register<number>;
  reviewEvents: Record<string, ReviewEventNode>;
  snapshot?: SchedulerSnapshotNode;
}

export interface SyncState {
  /** Interning table; stamps reference replicas by this list's index elsewhere if needed. */
  replicas: string[];
  /** Keyed by `word:<normalized>`. */
  words: Record<string, WordNode>;
  /** Keyed by quote entry id. */
  quotes: Record<string, QuoteNode>;
  /** Entity logical key -> delete stamp. */
  tombstones: Record<string, HybridTimestamp>;
  appSettings: Record<string, Register<unknown>>;
  aiSettings: Record<string, Register<unknown>>;
  kaikkiSource: Record<string, Register<unknown>>;
}

export interface SyncReplica {
  app: typeof APP_ID;
  formatVersion: 1;
  vaultId: string;
  replicaId: string;
  writtenAt: HybridTimestamp;
  state: SyncState;
}

export type SyncStatus =
  | 'disabled'
  | 'synced'
  | 'syncing'
  | 'pending'
  | 'needs-attention';

export type SyncErrorCode =
  | 'unsupported'
  | 'disconnected'
  | 'locked'
  | 'wrong-passphrase'
  | 'needs-reauthorization'
  | 'folder-unavailable'
  | 'vault-invalid'
  | 'replica-incompatible'
  | 'local-validation'
  | 'write-failure'
  | 'clock-skew';

export interface SyncError {
  code: SyncErrorCode;
  /** Optional replica filename for replica-specific warnings. */
  replica?: string;
}

export const EMPTY_SYNC_STATE: SyncState = {
  replicas: [],
  words: {},
  quotes: {},
  tombstones: {},
  appSettings: {},
  aiSettings: {},
  kaikkiSource: {},
};

export type { Status };
