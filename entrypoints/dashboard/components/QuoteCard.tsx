import { useRef, useState } from 'react';
import { formatMessage, t } from '@/lib/i18n';
import { addTag, removeTag } from '@/lib/tags';
import type { Cloze, QuoteEntry, UiLocale } from '@/lib/types';
import { ClozeEditor } from './ClozeEditor';
import { TraditionalButton } from './TraditionalButton';

export function QuoteCard({
  quote,
  onUpdate,
  onSetTags,
  onDelete,
  knownTags,
  locale,
  showParkedMarker = false,
}: {
  quote: QuoteEntry;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  onSetTags: (nextTags: string[]) => void;
  onDelete: () => void;
  knownTags: string[];
  locale: UiLocale;
  showParkedMarker?: boolean;
}) {
  const [note, setNote] = useState(quote.note);
  const [showTraditional, setShowTraditional] = useState(false);
  const [tagInput, setTagInput] = useState('');
  const listId = `tags-${quote.id}`;
  const suggestions = knownTags
    .filter((tag) => !quote.tags.includes(tag) && tag.includes(tagInput.trim().toLowerCase()))
    .slice(0, 8);

  function commitTag() {
    const raw = tagInput;
    setTagInput('');
    if (raw.trim() === '') return;
    onSetTags(addTag(quote.tags, raw));
  }
  // Drag-select reads the offsets back from this exact node. The mapping in
  // lib/cloze-selection.ts assumes the quote text lives under this span; keep
  // them in sync if the quote ever renders with inline decoration.
  const quoteTextRef = useRef<HTMLSpanElement>(null);

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)] transition hover:border-border-hover hover:shadow-[0_4px_14px_rgba(90,75,50,0.09)]">
      <div className="flex gap-3">
        <span
          aria-hidden="true"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-peach text-sm font-semibold text-peach-deep"
        >
          摘
        </span>
        <blockquote className="relative min-w-0 flex-1 border-l-[3px] border-peach py-1 pl-5 pr-4 text-base leading-8 text-ink tracking-[1px]">
          <span aria-hidden="true" className="absolute left-2 top-0 text-xl text-peach-deep/50">
            「
          </span>
          <span ref={quoteTextRef} data-quote-text>{quote.text}</span>
          <span aria-hidden="true" className="absolute bottom-0 right-1 text-xl text-peach-deep/50">
            」
          </span>
        </blockquote>
      </div>
      {showTraditional && quote.traditionalText && (
        <p className="mt-2 pl-5 text-sm italic text-accent-deep">{quote.traditionalText}</p>
      )}
      {showParkedMarker && (
        <div className="mt-2 flex items-center gap-2">
          <span className="inline-flex items-center rounded-full border border-accent-border bg-accent-tint px-2.5 py-0.5 text-[11px] font-semibold text-accent-deep tracking-[1px]">
            {t(locale, 'cloze.parked')}
          </span>
          <span className="text-xs text-muted">{t(locale, 'cloze.addBlank')}</span>
        </div>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        {quote.tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full border border-accent-border bg-accent-tint px-2.5 py-1 text-accent-deep"
          >
            #{tag}
            <button
              type="button"
              aria-label={formatMessage(locale, 'quote.removeTag', { tag })}
              onClick={() => onSetTags(removeTag(quote.tags, tag))}
              className="text-accent-deep/70 transition hover:text-accent-deep"
            >
              ×
            </button>
          </span>
        ))}
        <input
          value={tagInput}
          list={listId}
          onChange={(event) => setTagInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ',') {
              event.preventDefault();
              commitTag();
            }
          }}
          onBlur={commitTag}
          placeholder={t(locale, 'quote.addTag')}
          className="w-24 rounded-sm border border-border bg-paper-input px-2 py-1 text-ink outline-none transition focus:border-accent-fade"
        />
        <datalist id={listId}>
          {suggestions.map((tag) => (
            <option key={tag} value={tag} />
          ))}
        </datalist>
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-border bg-card-soft px-2.5 py-1 hover:text-accent-deep"
          >
            {quote.sourceTitle || quote.sourceDomain}
          </a>
        )}
        <TraditionalButton
          text={quote.text}
          existing={quote.traditionalText}
          onGenerated={(traditionalText) => onUpdate({ traditionalText })}
          shown={showTraditional}
          onToggle={() => setShowTraditional((value) => !value)}
          locale={locale}
        />
      </div>
      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== quote.note && onUpdate({ note })}
        placeholder={t(locale, 'quote.notePlaceholder')}
        rows={2}
        className="mt-3 w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-accent-fade"
      />
      <ClozeEditor
        quote={quote}
        onChange={(clozes: Cloze[]) => onUpdate({ clozes })}
        onUpdate={onUpdate}
        locale={locale}
        quoteTextRef={quoteTextRef}
      />
      <div className="mt-1 flex justify-end gap-1">
        {quote.status !== 'reviewed' && (
          <button
            onClick={() => onUpdate({ status: 'reviewed' })}
            title={t(locale, 'word.markReviewed')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-accent-border bg-accent-light text-xs font-semibold text-accent-deep transition hover:bg-accent hover:text-white"
          >
            {t(locale, 'word.markReviewedShort')}
          </button>
        )}
        {quote.status !== 'archived' && (
          <button
            onClick={() => onUpdate({ status: 'archived' })}
            title={t(locale, 'word.archive')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
          >
            {t(locale, 'word.archiveShort')}
          </button>
        )}
        <button
          onClick={onDelete}
          title={t(locale, 'word.delete')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-accent-border hover:bg-accent-light hover:text-accent-deep"
        >
          {t(locale, 'word.deleteShort')}
        </button>
      </div>
    </div>
  );
}
