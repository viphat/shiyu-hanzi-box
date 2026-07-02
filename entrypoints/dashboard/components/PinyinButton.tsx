import { Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { t } from '@/lib/i18n';
import { toPinyin } from '@/lib/pinyin';
import type { UiLocale } from '@/lib/types';

export function PinyinButton({
  text,
  onGenerated,
  existing,
  locale,
}: {
  text: string;
  existing?: string;
  onGenerated: (pinyin: string) => void;
  locale: UiLocale;
}) {
  const [busy, setBusy] = useState(false);
  if (existing) return <span className="text-xs italic text-accent-deep">{existing}</span>;

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        setBusy(true);
        const pinyin = toPinyin(text);
        onGenerated(pinyin);
        setBusy(false);
      }}
      className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-accent-deep"
    >
      {busy ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
      <Sparkles className="h-3 w-3" />
      )}
      {t(locale, 'pinyin.generate')}
    </button>
  );
}
