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
      <p className="py-8 text-center text-sm text-gray-400">
        No words yet. Select text on any page and save it.
      </p>
    );
  }

  return (
    <div className="space-y-2">
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
