import type { Inbox, Occurrence, QuoteEntry, ReviewState, Status, WordEntry } from './types';

export const BACKUP_APP = 'shiyu-hanzi-box';
export const BACKUP_FORMAT_VERSION = 1;

export interface InboxBackup {
  app: typeof BACKUP_APP;
  formatVersion: typeof BACKUP_FORMAT_VERSION;
  exportedAt: string;
  inbox: Inbox;
}

export class BackupParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BackupParseError';
  }
}

export function createBackup(inbox: Inbox, exportedAt = new Date()): InboxBackup {
  return {
    app: BACKUP_APP,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    inbox: cloneJson(inbox),
  };
}

export function serializeBackup(inbox: Inbox, exportedAt = new Date()): string {
  return `${JSON.stringify(createBackup(inbox, exportedAt), null, 2)}\n`;
}

export function parseBackup(json: string): Inbox {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    throw new BackupParseError('Backup file is not valid JSON.');
  }

  const inbox = readInboxPayload(parsed);
  if (!isInbox(inbox)) {
    throw new BackupParseError(
      'Invalid backup inbox: expected words and quotes arrays with persisted entry fields.',
    );
  }

  return cloneJson(inbox);
}

function readInboxPayload(value: unknown): unknown {
  if (!looksLikeBackupEnvelope(value)) return value;

  if (value.app !== BACKUP_APP) {
    throw new BackupParseError('Unsupported backup app.');
  }

  if (value.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new BackupParseError(
      `Unsupported backup format version: ${String(value.formatVersion)}.`,
    );
  }

  if (!isString(value.exportedAt) || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new BackupParseError(
      'Invalid backup metadata: exportedAt must be an ISO date string.',
    );
  }

  return value.inbox;
}

function looksLikeBackupEnvelope(value: unknown): value is Partial<InboxBackup> {
  return (
    isRecord(value) &&
    'inbox' in value &&
    ('app' in value || 'formatVersion' in value || 'exportedAt' in value)
  );
}

function isInbox(value: unknown): value is Inbox {
  return (
    isRecord(value) &&
    Array.isArray(value.words) &&
    Array.isArray(value.quotes) &&
    value.words.every(isWordEntry) &&
    value.quotes.every(isQuoteEntry)
  );
}

function isWordEntry(value: unknown): value is WordEntry {
  return (
    isRecord(value) &&
    value.kind === 'word' &&
    hasEntryBase(value) &&
    isString(value.normalized) &&
    Array.isArray(value.occurrences) &&
    value.occurrences.every(isOccurrence)
  );
}

function isQuoteEntry(value: unknown): value is QuoteEntry {
  return (
    isRecord(value) &&
    value.kind === 'quote' &&
    hasEntryBase(value) &&
    isString(value.category) &&
    isString(value.sourceTitle) &&
    isString(value.sourceUrl) &&
    isString(value.sourceDomain) &&
    isString(value.surrounding)
  );
}

function hasEntryBase(value: Record<string, unknown>): boolean {
  return (
    isString(value.id) &&
    isString(value.text) &&
    isStringArray(value.tags) &&
    isString(value.note) &&
    isStatus(value.status) &&
    isFiniteNumber(value.createdAt) &&
    isFiniteNumber(value.updatedAt) &&
    (value.pinyin === undefined || isString(value.pinyin)) &&
    (value.review === undefined || isReviewState(value.review))
  );
}

function isOccurrence(value: unknown): value is Occurrence {
  return (
    isRecord(value) &&
    isString(value.sourceTitle) &&
    isString(value.sourceUrl) &&
    isString(value.sourceDomain) &&
    isString(value.surrounding) &&
    isFiniteNumber(value.capturedAt)
  );
}

function isReviewState(value: unknown): value is ReviewState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.dueAt) &&
    isFiniteNumber(value.intervalDays) &&
    isFiniteNumber(value.repetitions) &&
    isFiniteNumber(value.lapses) &&
    (value.lastReviewedAt === undefined || isFiniteNumber(value.lastReviewedAt)) &&
    (value.queueRank === undefined || isFiniteNumber(value.queueRank))
  );
}

function isStatus(value: unknown): value is Status {
  return value === 'inbox' || value === 'reviewed' || value === 'archived';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
