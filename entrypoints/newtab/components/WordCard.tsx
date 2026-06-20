import { useState } from 'react';
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Tag,
  Trash2,
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
    <div className="rounded-lg border border-jade-100 bg-[#fbfefc] p-4 shadow-sm transition hover:border-jade-200 hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="rounded p-1 text-jade-500 hover:bg-jade-50 hover:text-jade-800"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <span className="text-2xl font-semibold text-jade-950">{word.text}</span>
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
                className="rounded bg-jade-100 px-2 py-0.5 text-xs text-jade-800"
              >
                #{tag}
              </span>
            ))}
            <span className="rounded bg-white px-2 py-0.5 text-xs text-gray-500">
              {word.occurrences.length} 次相遇
            </span>
            {latest && (
              <span className="truncate rounded bg-white px-2 py-0.5 text-xs text-gray-400">
                {latest.sourceTitle || latest.sourceDomain}
              </span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {word.status !== 'reviewed' && (
            <button
              title="Mark reviewed"
              onClick={() => onUpdate({ status: 'reviewed' })}
              className="rounded p-1 text-gray-400 hover:bg-jade-50 hover:text-jade-700"
            >
              <Check className="h-4 w-4" />
            </button>
          )}
          {word.status !== 'archived' && (
            <button
              title="Archive"
              onClick={() => onUpdate({ status: 'archived' })}
              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            >
              <Archive className="h-4 w-4" />
            </button>
          )}
          <button
            title="Delete"
            onClick={onDelete}
            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 space-y-3 border-t border-jade-100 pt-3 text-sm">
          <ul className="space-y-1.5">
            {word.occurrences.map((occurrence, index) => (
              <li key={index} className="truncate rounded bg-white px-2 py-1 text-xs text-gray-500">
                <a
                  href={occurrence.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-jade-700"
                >
                  {occurrence.sourceTitle || occurrence.sourceDomain}
                </a>
                {occurrence.surrounding && (
                  <span className="text-gray-400"> · {occurrence.surrounding}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Tag className="h-3 w-3 text-jade-500" />
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
              placeholder="add tag..."
              className="w-40 border-b border-jade-100 bg-transparent text-xs outline-none focus:border-jade-400"
            />
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => note !== word.note && onUpdate({ note })}
            placeholder="写一点自己的理解..."
            className="w-full resize-none rounded-lg border border-jade-100 bg-white p-2 text-xs outline-none focus:border-jade-400"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
