import { clozesOverlap } from './cloze';
import type {
  AiSettings,
  AppSettings,
  Cloze,
  Inbox,
  Occurrence,
  QuoteEntry,
  ReviewCardState,
  ReviewRating,
  ReviewScheduler,
  ReviewState,
  Status,
  WordEntry,
} from './types';

export const BACKUP_APP = 'shiyu-hanzi-box';
export const BACKUP_FORMAT_VERSION = 2;

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
    inbox: cloneInbox(inbox),
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

  return cloneInbox(inbox);
}

function readInboxPayload(value: unknown): unknown {
  if (!looksLikeBackupEnvelope(value)) return value;

  if (value.app !== BACKUP_APP) {
    throw new BackupParseError('Unsupported backup app.');
  }

  if (
    typeof value.formatVersion !== 'number' ||
    value.formatVersion > BACKUP_FORMAT_VERSION
  ) {
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
    isStringArray(value.tags) &&
    isString(value.sourceTitle) &&
    isString(value.sourceUrl) &&
    isString(value.sourceDomain) &&
    isString(value.surrounding)
    // clozes: not checked here — sanitized in cloneInbox (invalid → [])
  );
}

function isCloze(value: unknown, textLength: number): value is Cloze {
  if (!isRecord(value)) return false;
  if (!isString(value.id)) return false;
  if (!isFiniteNumber(value.start) || !isFiniteNumber(value.end)) return false;
  if (
    value.start < 0 ||
    value.end <= value.start ||
    value.end > textLength
  ) {
    return false;
  }
  if (
    value.hint !== undefined &&
    value.hint !== 'none' &&
    value.hint !== 'pinyin' &&
    value.hint !== 'length'
  ) {
    return false;
  }
  if (value.wordId !== undefined && !isString(value.wordId)) return false;
  if (value.review !== undefined && !isReviewState(value.review)) return false;
  return true;
}

function sanitizeQuoteClozes(quote: QuoteEntry): QuoteEntry {
  if (quote.clozes === undefined) return quote;
  // Not an array: sanitize to []
  if (!Array.isArray(quote.clozes)) return { ...quote, clozes: [] };
  const textLength = quote.text.length;
  // All entries must be valid clozes
  const allValid = quote.clozes.every((c) => isCloze(c, textLength));
  if (!allValid) return { ...quote, clozes: [] };
  // No overlapping spans
  if (clozesOverlap(quote.clozes)) return { ...quote, clozes: [] };
  return quote;
}

function hasEntryBase(value: Record<string, unknown>): boolean {
  // Optional fields added after backup format v1, such as WordEntry.aiInsight,
  // are intentionally not checked here; cloneJson preserves them on round-trip.
  return (
    isString(value.id) &&
    isString(value.text) &&
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

function isReviewScheduler(value: unknown): value is ReviewScheduler {
  return value === 'fixed-v1' || value === 'fsrs-v1';
}

function isReviewCardState(value: unknown): value is ReviewCardState {
  return (
    value === 'new' ||
    value === 'learning' ||
    value === 'review' ||
    value === 'relearning'
  );
}

function isReviewRating(value: unknown): value is ReviewRating {
  return (
    value === 'again' ||
    value === 'hard' ||
    value === 'good' ||
    value === 'easy'
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= 0
  );
}

function isNonNegativeNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0;
}

function isDifficulty(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 1 && value <= 10;
}

function isProbability(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isReviewState(value: unknown): value is ReviewState {
  return (
    isRecord(value) &&
    isFiniteNumber(value.dueAt) &&
    isNonNegativeNumber(value.intervalDays) &&
    isNonNegativeInteger(value.repetitions) &&
    isNonNegativeInteger(value.lapses) &&
    (value.scheduler === undefined ||
      isReviewScheduler(value.scheduler)) &&
    (value.lastReviewedAt === undefined || isFiniteNumber(value.lastReviewedAt)) &&
    (value.queueRank === undefined || isFiniteNumber(value.queueRank)) &&
    (value.cardState === undefined ||
      isReviewCardState(value.cardState)) &&
    (value.stability === undefined ||
      isNonNegativeNumber(value.stability)) &&
    (value.difficulty === undefined ||
      isDifficulty(value.difficulty)) &&
    (value.elapsedDays === undefined ||
      isNonNegativeNumber(value.elapsedDays)) &&
    (value.scheduledDays === undefined ||
      isNonNegativeNumber(value.scheduledDays)) &&
    (value.learningSteps === undefined ||
      isNonNegativeInteger(value.learningSteps)) &&
    (value.retrievability === undefined ||
      isProbability(value.retrievability)) &&
    (value.reviewLog === undefined ||
      (Array.isArray(value.reviewLog) &&
        value.reviewLog.every(isReviewLogEntry)))
  );
}

function isReviewLogEntry(value: unknown): boolean {
  return (
    isRecord(value) &&
    isFiniteNumber(value.reviewedAt) &&
    isReviewRating(value.rating) &&
    isNonNegativeNumber(value.elapsedDays) &&
    isNonNegativeNumber(value.scheduledDays) &&
    isReviewCardState(value.stateBefore) &&
    isReviewCardState(value.stateAfter) &&
    (value.stabilityBefore === undefined ||
      isNonNegativeNumber(value.stabilityBefore)) &&
    (value.stabilityAfter === undefined ||
      isNonNegativeNumber(value.stabilityAfter)) &&
    (value.difficultyBefore === undefined ||
      isDifficulty(value.difficultyBefore)) &&
    (value.difficultyAfter === undefined ||
      isDifficulty(value.difficultyAfter))
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

function cloneInbox(inbox: Inbox): Inbox {
  return {
    words: inbox.words.map((word) => {
      const { tags: _tags, ...rest } = word as WordEntry & { tags?: unknown };
      return cloneJson(rest) as WordEntry;
    }),
    quotes: cloneJson(inbox.quotes).map((quote) => sanitizeQuoteClozes(quote)),
  };
}

// ---------------------------------------------------------------------------
// Full backup (format version 3): inbox + app settings + AI settings
// ---------------------------------------------------------------------------

export const FULL_BACKUP_FORMAT_VERSION = 3 as const;

export interface FullBackup {
  app: typeof BACKUP_APP;
  formatVersion: typeof FULL_BACKUP_FORMAT_VERSION;
  exportedAt: string;
  inbox: Inbox;
  settings: AppSettings;
  aiSettings: AiSettings;
}

export function createFullBackup(
  inbox: Inbox,
  settings: AppSettings,
  aiSettings: AiSettings,
  exportedAt = new Date(),
): FullBackup {
  return {
    app: BACKUP_APP,
    formatVersion: FULL_BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    inbox: cloneInbox(inbox),
    settings,
    aiSettings,
  };
}

export function serializeFullBackup(
  inbox: Inbox,
  settings: AppSettings,
  aiSettings: AiSettings,
  exportedAt = new Date(),
): string {
  return `${JSON.stringify(createFullBackup(inbox, settings, aiSettings, exportedAt), null, 2)}\n`;
}

function isAppSettings(value: unknown): value is AppSettings {
  return (
    isRecord(value) &&
    isString((value as Record<string, unknown>).uiLocale) &&
    isRecord((value as Record<string, unknown>).srs) &&
    isRecord((value as Record<string, unknown>).kaikki)
  );
}

function isAiSettings(value: unknown): value is AiSettings {
  return (
    isRecord(value) &&
    typeof (value as Record<string, unknown>).enabled === 'boolean' &&
    isString((value as Record<string, unknown>).provider) &&
    isString((value as Record<string, unknown>).baseUrl) &&
    isString((value as Record<string, unknown>).apiKey) &&
    isString((value as Record<string, unknown>).model)
  );
}

export function restoreFullBackup(raw: string): {
  inbox: Inbox;
  settings?: AppSettings;
  aiSettings?: AiSettings;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new BackupParseError('Backup file is not valid JSON.');
  }

  const value = parsed as Record<string, unknown>;
  if (value && value.formatVersion === FULL_BACKUP_FORMAT_VERSION) {
    if (!isInbox(value.inbox)) {
      throw new BackupParseError('Invalid v3 backup: inbox is malformed.');
    }
    if (value.settings !== undefined && !isAppSettings(value.settings)) {
      throw new BackupParseError('Invalid v3 backup: settings is malformed.');
    }
    if (value.aiSettings !== undefined && !isAiSettings(value.aiSettings)) {
      throw new BackupParseError('Invalid v3 backup: aiSettings is malformed.');
    }
    return {
      inbox: cloneInbox(value.inbox as Inbox),
      settings: value.settings as AppSettings | undefined,
      aiSettings: value.aiSettings as AiSettings | undefined,
    };
  }
  // Fallback: treat as inbox-only backup (formatVersion 2 or lower); settings/AI left undefined.
  return { inbox: parseBackup(raw) };
}
