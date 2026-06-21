import type { ExternalDictionaryLink, HighlightedExample } from '@/lib/types';

export function SourceExamples({
  examples,
  externalLinks,
}: {
  examples: HighlightedExample[];
  externalLinks: ExternalDictionaryLink[];
}) {
  return (
    <div className="space-y-2">
      {examples.map((ex, i) => (
        <HighlightedLine key={i} example={ex} />
      ))}
      {externalLinks.length > 0 && (
        <div className="flex flex-wrap gap-2 pt-1">
          {externalLinks.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noreferrer"
              className="rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function HighlightedLine({ example }: { example: HighlightedExample }) {
  const parts = renderWithRanges(example.snippet, example.ranges);
  const sourceLabel = example.sourceTitle || '来源';
  return (
    <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs">
      {example.snippet ? (
        <p className="leading-5 text-ink-secondary">{parts}</p>
      ) : (
        <p className="text-muted">（无上下文）</p>
      )}
      {example.sourceUrl ? (
        <a
          href={example.sourceUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-1 inline-block text-[11px] text-muted hover:text-cinnabar"
        >
          {sourceLabel} ↗
        </a>
      ) : (
        <span className="mt-1 inline-block text-[11px] text-muted">{sourceLabel}</span>
      )}
    </div>
  );
}

function renderWithRanges(snippet: string, ranges: HighlightedExample['ranges']) {
  if (ranges.length === 0) return snippet;
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const out: Array<string | { key: string; text: string }> = [];
  let cursor = 0;
  for (const range of sorted) {
    if (range.start > cursor) out.push(snippet.slice(cursor, range.start));
    out.push({ key: `h${range.start}`, text: snippet.slice(range.start, range.end) });
    cursor = range.end;
  }
  if (cursor < snippet.length) out.push(snippet.slice(cursor));
  return out.map((part, i) =>
    typeof part === 'string' ? (
      <span key={`s${i}`}>{part}</span>
    ) : (
      <mark key={part.key} className="rounded-sm bg-cinnabar/20 px-0.5 text-cinnabar">
        {part.text}
      </mark>
    ),
  );
}
