import { formatMessage, t } from '@/lib/i18n';
import { tagCounts } from '@/lib/tags';
import type { QuoteEntry, UiLocale } from '@/lib/types';

export function TagCloud({
  quotes,
  selectedTags,
  onSelect,
  onRename,
  onDelete,
  locale,
}: {
  quotes: QuoteEntry[];
  selectedTags: Set<string>;
  onSelect: (tag: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
  locale: UiLocale;
}) {
  const counts = [...tagCounts(quotes).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (counts.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-border bg-paper-light py-10 text-center">
        <p className="text-sm text-muted">{t(locale, 'cloud.empty')}</p>
      </div>
    );
  }

  const max = counts[0][1];
  const min = counts[counts.length - 1][1];
  const sizeFor = (count: number) => {
    if (max === min) return 1;
    return 0.85 + (1.6 * (count - min)) / (max - min); // rem, 0.85–2.45
  };

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-sm border border-border bg-paper-light p-4">
      {counts.map(([tag, count]) => (
        <span key={tag} className="group inline-flex items-center gap-1">
          <button
            type="button"
            onClick={() => onSelect(tag)}
            style={{ fontSize: `${sizeFor(count)}rem` }}
            className={`leading-none transition hover:text-cinnabar ${selectedTags.has(tag) ? 'text-cinnabar' : 'text-ink'}`}
          >
            {tag}
          </button>
          <button
            type="button"
            aria-label={formatMessage(locale, 'cloud.rename', { tag })}
            onClick={() => {
              const next = window.prompt(formatMessage(locale, 'cloud.renamePrompt', { tag }), tag);
              if (next && next.trim() !== '') onRename(tag, next);
            }}
            className="text-xs text-muted opacity-0 transition hover:text-ink group-hover:opacity-100"
          >
            ✎
          </button>
          <button
            type="button"
            aria-label={formatMessage(locale, 'cloud.delete', { tag })}
            onClick={() => {
              if (window.confirm(formatMessage(locale, 'cloud.deleteConfirm', { tag }))) onDelete(tag);
            }}
            className="text-xs text-muted opacity-0 transition hover:text-cinnabar group-hover:opacity-100"
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
