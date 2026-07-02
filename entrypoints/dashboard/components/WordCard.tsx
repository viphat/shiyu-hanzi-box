import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import {
  displayableOccurrences,
  latestDisplayableOccurrence,
  occurrenceSourceLabel,
} from '@/lib/occurrences';
import { t } from '@/lib/i18n';
import type { UiLocale, WordEntry } from '@/lib/types';
import { PinyinButton } from './PinyinButton';
import { SpeakButton } from './SpeakButton';
import { TraditionalButton } from './TraditionalButton';
import { WordInsightPanel } from './WordInsightPanel';

export function WordCard({
  word,
  onUpdate,
  onDelete,
  locale,
}: {
  word: WordEntry;
  onUpdate: (patch: Partial<WordEntry>) => void;
  onDelete: () => void;
  locale: UiLocale;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(word.note);
  const [showTraditional, setShowTraditional] = useState(false);
  const occurrences = displayableOccurrences(word.occurrences);
  const latest = latestDisplayableOccurrence(word.occurrences);
  const latestLabel = latest ? occurrenceSourceLabel(latest) : '';

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)] transition hover:border-border-hover hover:shadow-[0_4px_14px_rgba(90,75,50,0.09)]">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span
              aria-hidden="true"
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent-wash text-sm font-semibold text-accent-deep"
            >
              词
            </span>
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-full p-1 text-muted transition hover:bg-accent-tint hover:text-ink-secondary"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <span className="text-[32px] font-bold leading-none text-ink tracking-[4px]">{word.text}</span>
            <PinyinButton
              text={word.text}
              existing={word.pinyin}
              onGenerated={(pinyin) => onUpdate({ pinyin })}
              locale={locale}
            />
            <SpeakButton text={word.text} locale={locale} />
            <TraditionalButton
              text={word.text}
              existing={word.traditionalText}
              onGenerated={(traditionalText) => onUpdate({ traditionalText })}
              shown={showTraditional}
              onToggle={() => setShowTraditional((value) => !value)}
              locale={locale}
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-11">
            {occurrences.length > 0 && (
              <span className="rounded-full border border-border bg-card-soft px-2.5 py-0.5 text-xs text-muted">
                {occurrences.length} {t(locale, 'word.encounters')}
              </span>
            )}
            {latestLabel && (
              <span className="truncate rounded-full border border-border bg-card-soft px-2.5 py-0.5 text-xs text-muted">
                {latestLabel}
              </span>
            )}
            {showTraditional && word.traditionalText && (
              <span className="text-xs italic text-accent-deep">{word.traditionalText}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {!expanded && (
            <button
              title={t(locale, 'word.openAiInsight')}
              onClick={() => setExpanded(true)}
              className="inline-flex h-7 items-center justify-center gap-1 rounded-full border border-border bg-card-soft px-2.5 text-xs font-semibold text-muted transition hover:border-accent-border hover:text-accent-deep"
            >
              <Sparkles className="h-3 w-3" />
              AI
            </button>
          )}
          {word.status !== 'reviewed' && (
            <button
              title={t(locale, 'word.markReviewed')}
              onClick={() => onUpdate({ status: 'reviewed' })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent-border bg-accent-light text-xs font-semibold text-accent-deep transition hover:bg-accent hover:text-white"
            >
              {t(locale, 'word.markReviewedShort')}
            </button>
          )}
          {word.status !== 'archived' && (
            <button
              title={t(locale, 'word.archive')}
              onClick={() => onUpdate({ status: 'archived' })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
            >
              {t(locale, 'word.archiveShort')}
            </button>
          )}
          <button
            title={t(locale, 'word.delete')}
            onClick={onDelete}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-accent-border hover:bg-accent-light hover:text-accent-deep"
          >
            {t(locale, 'word.deleteShort')}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-border pt-3 text-sm">
          <WordInsightPanel word={word} locale={locale} />

          {occurrences.length > 0 && (
            <details className="rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs">
              <summary className="cursor-pointer text-muted">
                {t(locale, 'word.allEncounters')} ({occurrences.length})
              </summary>
              <ul className="mt-1.5 space-y-1.5">
                {occurrences.map((occurrence, index) => {
                  const label = occurrenceSourceLabel(occurrence);
                  return (
                    <li key={index} className="truncate rounded-sm border border-border bg-paper-light px-2 py-1 text-xs text-muted">
                      {label && occurrence.sourceUrl ? (
                        <a
                          href={occurrence.sourceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent-deep"
                        >
                          {label}
                        </a>
                      ) : (
                        label && <span>{label}</span>
                      )}
                      {occurrence.surrounding && (
                        <span className="text-muted">{label ? ' · ' : ''}{occurrence.surrounding}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => note !== word.note && onUpdate({ note })}
            placeholder={t(locale, 'word.notePlaceholder')}
            className="w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-accent-fade"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
