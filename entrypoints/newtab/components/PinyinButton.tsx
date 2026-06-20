import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { toPinyin } from '@/lib/pinyin';

export function PinyinButton({
  text,
  onGenerated,
  existing,
}: {
  text: string;
  existing?: string;
  onGenerated: (pinyin: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  if (existing) return <span className="text-xs italic text-cinnabar">{existing}</span>;

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        const pinyin = toPinyin(text);
        onGenerated(pinyin);
        setBusy(false);
      }}
      className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-cinnabar"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <Sparkles className="h-3 w-3" />
      )}
      注音
    </button>
  );
}
