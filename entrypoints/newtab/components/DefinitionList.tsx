import type { DictionaryEntry } from '@/lib/types';

export function DefinitionList({
  title,
  entries,
  emptyHint,
}: {
  title: string;
  entries: DictionaryEntry[];
  emptyHint?: string;
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
          <li key={entry.index} className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
            <span className="text-xs text-cinnabar">{entry.pinyin}</span>
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
