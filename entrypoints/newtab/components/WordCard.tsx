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

  return (
    <div className="rounded-lg border bg-white p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-gray-400 hover:text-gray-600"
            >
              {expanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>
            <span className="text-lg font-medium text-ink">{word.text}</span>
            <PinyinButton
              text={word.text}
              existing={word.pinyin}
              onGenerated={(pinyin) => onUpdate({ pinyin })}
            />
          </div>
          <div className="mt-1 flex flex-wrap gap-1">
            {word.tags.map((tag) => (
              <span
                key={tag}
                className="rounded bg-jade-50 px-1.5 py-0.5 text-xs text-jade-700"
              >
                #{tag}
              </span>
            ))}
            <span className="text-xs text-gray-400">{word.occurrences.length}x</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          {word.status !== 'reviewed' && (
            <button
              title="Mark reviewed"
              onClick={() => onUpdate({ status: 'reviewed' })}
              className="rounded p-1 text-gray-400 hover:bg-green-50 hover:text-green-600"
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
        <div className="mt-3 space-y-2 border-t pt-2 text-sm">
          <ul className="space-y-1">
            {word.occurrences.map((occurrence, index) => (
              <li key={index} className="truncate text-xs text-gray-500">
                <a
                  href={occurrence.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:text-jade-700"
                >
                  {occurrence.sourceTitle || occurrence.sourceDomain}
                </a>
                {occurrence.surrounding && (
                  <span className="text-gray-400"> - {occurrence.surrounding}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-1">
            <Tag className="h-3 w-3 text-gray-400" />
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
              className="w-32 border-b text-xs outline-none focus:border-jade-400"
            />
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            onBlur={() => note !== word.note && onUpdate({ note })}
            placeholder="note..."
            className="w-full resize-none rounded border p-1 text-xs outline-none focus:border-jade-400"
            rows={2}
          />
        </div>
      )}
    </div>
  );
}
