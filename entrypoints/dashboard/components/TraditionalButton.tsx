import { Sparkles } from 'lucide-react';
import { t } from '@/lib/i18n';
import { toTraditionalTaiwan } from '@/lib/traditional';
import type { UiLocale } from '@/lib/types';

export function TraditionalButton({
  text,
  existing,
  onGenerated,
  shown,
  onToggle,
  locale,
}: {
  text: string;
  existing?: string;
  onGenerated: (traditionalText: string) => void;
  shown: boolean;
  onToggle: () => void;
  locale: UiLocale;
}) {
  if (existing) {
    return (
      <button
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        title={shown ? t(locale, 'traditional.hide') : t(locale, 'traditional.show')}
        className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs transition ${
          shown
            ? 'border-cinnabar-border bg-cinnabar-light text-cinnabar'
            : 'border-border bg-transparent text-muted hover:border-border-hover hover:text-ink-secondary'
        }`}
      >
        繁
      </button>
    );
  }

  return (
    <button
      onClick={(event) => {
        event.stopPropagation();
        onGenerated(toTraditionalTaiwan(text));
      }}
      className="inline-flex items-center gap-1 text-xs text-muted transition hover:text-cinnabar"
    >
      <Sparkles className="h-3 w-3" />
      {t(locale, 'traditional.generate')}
    </button>
  );
}
