import type { WordEntry } from '@/lib/types';
import { WordCard } from './WordCard';

export function WordList({
  words,
  onUpdate,
  onDelete,
}: {
  words: WordEntry[];
  onUpdate: (id: string, patch: Partial<WordEntry>) => void;
  onDelete: (id: string) => void;
}) {
  if (words.length === 0) {
    return (
      <div className="py-12 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-jade-50 text-2xl text-jade-700">
          词
        </div>
        <p className="text-sm font-medium text-jade-900">还没有词语</p>
        <p className="mt-1 text-sm text-gray-400">去网页里拾一个字词，收藏箱会在这里展开。</p>
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {words.map((word) => (
        <WordCard
          key={word.id}
          word={word}
          onUpdate={(patch) => onUpdate(word.id, patch)}
          onDelete={() => onDelete(word.id)}
        />
      ))}
    </div>
  );
}
