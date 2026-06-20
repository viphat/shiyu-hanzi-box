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
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-12 text-center">
        <div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center text-[56px] leading-none text-ink/12">
          词
        </div>
        <p className="text-base font-medium text-ink-secondary tracking-[3px]">还没有词语</p>
        <p className="mt-1 text-xs text-muted">去网页里拾一个字词，收藏箱会在这里展开。</p>
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
