import type { DictionaryEntry, UiLocale } from '@/lib/types';
import { t } from '@/lib/i18n';

export function DefinitionList({
  title,
  entries,
  emptyHint,
  locale,
}: {
  title: string;
  entries: DictionaryEntry[];
  emptyHint?: string;
  locale: UiLocale;
}) {
  if (entries.length === 0) {
    if (!emptyHint) return null;
    return <p className="text-xs text-muted">{emptyHint}</p>;
  }
  return (
    <div className="space-y-1.5">
      <p className="text-[11px] font-medium uppercase tracking-[2px] text-muted">{title}</p>
      <ul className="space-y-1.5">
        {entries.map((entry) => (
          <li key={`${entry.source ?? 'dictionary'}:${entry.index}`} className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
            <div className="flex flex-wrap items-center gap-2">
              {entry.pinyin && <span className="text-xs text-accent-deep">{entry.pinyin}</span>}
              {entry.source === 'kaikki' && (
                <span className="rounded-sm border border-accent-border bg-accent-light px-1.5 py-0.5 text-[10px] text-accent-deep">
                  {t(locale, 'dictionary.kaikkiBadge')}
                </span>
              )}
            </div>
            <ul className="mt-0.5 space-y-0.5">
              {entry.definitions.map((def, i) => (
                <li key={i} className="text-xs text-ink-secondary">{def}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </div>
  );
}
