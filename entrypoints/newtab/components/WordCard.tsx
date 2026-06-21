import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import {
  displayableOccurrences,
  latestDisplayableOccurrence,
  occurrenceSourceLabel,
} from '@/lib/occurrences';
import type { WordEntry } from '@/lib/types';
import { PinyinButton } from './PinyinButton';
import { WordInsightPanel } from './WordInsightPanel';

export function WordCard({
  word,
  onUpdate,
  onDelete,
}: {
  word: WordEntry;
  onUpdate: (patch: Partial<WordEntry>) => void;
  onDelete: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(word.note);
  const occurrences = displayableOccurrences(word.occurrences);
  const latest = latestDisplayableOccurrence(word.occurrences);
  const latestLabel = latest ? occurrenceSourceLabel(latest) : '';

  return (
    <div className="rounded-sm border border-border bg-paper-light p-4 shadow-sm transition hover:border-border-hover hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded-sm p-1 text-muted transition hover:bg-paper-input hover:text-ink-secondary"
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
            />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5 pl-7">
            <span className="rounded-sm border border-border bg-paper-input px-2 py-0.5 text-xs text-muted">
              {occurrences.length} 次相遇
            </span>
            {latestLabel && (
              <span className="truncate rounded-sm border border-border bg-paper-input px-2 py-0.5 text-xs text-muted">
                {latestLabel}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {word.status !== 'reviewed' && (
            <button
              title="标为复习中"
              onClick={() => onUpdate({ status: 'reviewed' })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-cinnabar-border bg-cinnabar-light text-xs font-semibold text-cinnabar transition hover:bg-cinnabar hover:text-white"
            >
              阅
            </button>
          )}
          {word.status !== 'archived' && (
            <button
              title="归档"
              onClick={() => onUpdate({ status: 'archived' })}
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
            >
              档
            </button>
          )}
          <button
            title="删除"
            onClick={onDelete}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar"
          >
            删
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-border pt-3 text-sm">
          <WordInsightPanel word={word} />

          {occurrences.length > 0 && (
            <details className="rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs">
              <summary className="cursor-pointer text-muted">所有相遇（{occurrences.length}）</summary>
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
                          className="hover:text-cinnabar"
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
            placeholder="写一点自己的理解..."
            className="w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-cinnabar-fade"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
