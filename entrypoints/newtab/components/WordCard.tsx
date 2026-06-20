import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Tag,
} from 'lucide-react';
import type { WordEntry } from '@/lib/types';
import { PinyinButton } from './PinyinButton';

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
  const [tagInput, setTagInput] = useState('');
  const [note, setNote] = useState(word.note);
  const latest = word.occurrences[0];

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
            {word.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-0.5 text-xs text-cinnabar tracking-[1px]"
              >
                #{tag}
              </span>
            ))}
            <span className="rounded-sm border border-border bg-paper-input px-2 py-0.5 text-xs text-muted">
              {word.occurrences.length} 次相遇
            </span>
            {latest && (
              <span className="truncate rounded-sm border border-border bg-paper-input px-2 py-0.5 text-xs text-muted">
                {latest.sourceTitle || latest.sourceDomain}
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
          <ul className="space-y-1.5">
            {word.occurrences.map((occurrence, index) => (
              <li key={index} className="truncate rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted">
                <a
                  href={occurrence.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-cinnabar"
                >
                  {occurrence.sourceTitle || occurrence.sourceDomain}
                </a>
                {occurrence.surrounding && (
                  <span className="text-muted"> · {occurrence.surrounding}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Tag className="h-3 w-3 text-cinnabar" />
            <input
              value={tagInput}
              onChange={(event) => setTagInput(event.target.value)}
              onKeyDown={(event) => {
                const tag = tagInput.trim();
                if (event.key === 'Enter' && tag) {
                  onUpdate({ tags: [...word.tags, tag] });
                  setTagInput('');
                }
              }}
              placeholder="添标签..."
              className="w-40 border-b border-border bg-transparent text-xs text-ink outline-none transition placeholder:text-muted focus:border-cinnabar-fade"
            />
          </div>
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
