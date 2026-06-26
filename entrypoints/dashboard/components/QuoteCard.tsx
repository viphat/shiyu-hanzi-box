import { useState } from 'react';
import { clozesOverlap, normalizeClozes, suggestClozes } from '@/lib/cloze';
import { t } from '@/lib/i18n';
import type { Cloze, QuoteEntry, UiLocale, WordEntry } from '@/lib/types';
import { TraditionalButton } from './TraditionalButton';

export function QuoteCard({
  quote,
  words,
  onUpdate,
  onDelete,
  locale,
  highlightParked = false,
}: {
  quote: QuoteEntry;
  words: WordEntry[];
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  onDelete: () => void;
  locale: UiLocale;
  highlightParked?: boolean;
}) {
  const [note, setNote] = useState(quote.note);
  const [showTraditional, setShowTraditional] = useState(false);
  const [suggestions, setSuggestions] = useState<Cloze[] | null>(null);

  const existingClozes: Cloze[] = quote.clozes ?? [];

  function handleSuggest() {
    const all = suggestClozes(quote.text, words);
    // Filter out suggestions that overlap any existing cloze
    const filtered = all.filter(
      (s) => !existingClozes.some((c) => clozesOverlap(c, s)),
    );
    setSuggestions(filtered);
  }

  function handleAcceptSuggestion(suggestion: Cloze) {
    // Reject if overlaps any existing cloze
    if (existingClozes.some((c) => clozesOverlap(c, suggestion))) {
      return;
    }
    const next = normalizeClozes([...existingClozes, suggestion], quote.text.length);
    onUpdate({ clozes: next });
    // Remove accepted suggestion from the list
    setSuggestions((prev) =>
      prev ? prev.filter((s) => s.id !== suggestion.id) : null,
    );
  }

  function handleRemoveCloze(id: string) {
    const next = existingClozes.filter((c) => c.id !== id);
    onUpdate({ clozes: next });
  }

  function handleChangeHint(id: string, hint: Cloze['hint']) {
    const next = existingClozes.map((c) => (c.id === id ? { ...c, hint } : c));
    onUpdate({ clozes: next });
  }

  return (
    <div
      className={`rounded-sm border bg-paper-light p-4 shadow-sm transition hover:shadow-md ${
        highlightParked
          ? 'border-amber-300 hover:border-amber-400'
          : 'border-border hover:border-border-hover'
      }`}
    >
      {/* Parked badge — shown when the quote has no clozes and is not archived */}
      {highlightParked && (
        <div className="mb-2 flex items-center gap-2">
          <span className="inline-flex items-center rounded-sm border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
            {t(locale, 'cloze.parked')}
          </span>
        </div>
      )}

      <blockquote className="relative border-l-[3px] border-cinnabar-fade py-1 pl-5 pr-4 text-base leading-8 text-ink tracking-[1px]">
        <span aria-hidden="true" className="absolute left-2 top-0 text-xl text-cinnabar/40">
          「
        </span>
        <span>{quote.text}</span>
        <span aria-hidden="true" className="absolute bottom-0 right-1 text-xl text-cinnabar/40">
          」
        </span>
      </blockquote>
      {showTraditional && quote.traditionalText && (
        <p className="mt-2 pl-5 text-sm italic text-cinnabar">{quote.traditionalText}</p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
        <input
          value={quote.category}
          onChange={(event) => onUpdate({ category: event.target.value })}
          className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-cinnabar outline-none transition focus:border-cinnabar-fade focus:bg-paper-input"
        />
        {quote.sourceUrl && (
          <a
            href={quote.sourceUrl}
            target="_blank"
            rel="noreferrer"
            className="rounded-sm border border-border bg-paper-input px-2 py-1 hover:text-cinnabar"
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

      {/* Cloze editor section */}
      <div className="mt-3 space-y-2">
        {/* Existing cloze chips */}
        {existingClozes.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {existingClozes.map((cloze) => (
              <span
                key={cloze.id}
                data-cloze-id={cloze.id}
                className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-0.5 text-xs text-cinnabar"
              >
                <span>{quote.text.slice(cloze.start, cloze.end)}</span>
                <select
                  data-cloze-hint={cloze.id}
                  value={cloze.hint ?? 'none'}
                  onChange={(e) => handleChangeHint(cloze.id, e.target.value as Cloze['hint'])}
                  className="bg-transparent text-xs outline-none"
                >
                  <option value="none">{t(locale, 'cloze.hintNone')}</option>
                  <option value="pinyin">{t(locale, 'cloze.hintPinyin')}</option>
                  <option value="length">{t(locale, 'cloze.hintLength')}</option>
                </select>
                <button
                  data-action="remove-cloze"
                  data-cloze-id={cloze.id}
                  onClick={() => handleRemoveCloze(cloze.id)}
                  title={t(locale, 'cloze.removeBlank')}
                  className="ml-0.5 text-cinnabar/60 hover:text-cinnabar"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        {/* Suggest blanks / Add a blank to review */}
        <div className="flex flex-wrap items-start gap-2">
          {/* For parked quotes, render the button with data-parked-cta for prominent affordance */}
          {highlightParked ? (
            <button
              data-parked-cta
              onClick={handleSuggest}
              className="rounded-sm border border-amber-300 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-700 transition hover:border-amber-400 hover:bg-amber-100"
            >
              {t(locale, 'cloze.addBlank')}
            </button>
          ) : (
            <button
              onClick={handleSuggest}
              className="rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar"
            >
              {t(locale, 'cloze.addBlank')}
            </button>
          )}

          {/* Suggestions */}
          {suggestions !== null && suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {suggestions.map((s) => (
                <button
                  key={s.id}
                  data-action="accept-suggestion"
                  onClick={() => handleAcceptSuggestion(s)}
                  className="rounded-sm border border-border bg-paper-input px-2 py-0.5 text-xs text-ink-secondary transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar"
                >
                  {quote.text.slice(s.start, s.end)}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <textarea
        value={note}
        onChange={(event) => setNote(event.target.value)}
        onBlur={() => note !== quote.note && onUpdate({ note })}
        placeholder={t(locale, 'quote.notePlaceholder')}
        rows={2}
        className="mt-3 w-full resize-none rounded-sm border border-border bg-paper-input p-2 text-xs text-ink outline-none transition placeholder:text-muted focus:border-cinnabar-fade"
      />
      <div className="mt-1 flex justify-end gap-1">
        {quote.status !== 'reviewed' && (
          <button
            onClick={() => onUpdate({ status: 'reviewed' })}
            title={t(locale, 'word.markReviewed')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-cinnabar-border bg-cinnabar-light text-xs font-semibold text-cinnabar transition hover:bg-cinnabar hover:text-white"
          >
            {t(locale, 'word.markReviewedShort')}
          </button>
        )}
        {quote.status !== 'archived' && (
          <button
            onClick={() => onUpdate({ status: 'archived' })}
            title={t(locale, 'word.archive')}
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-border-hover hover:bg-paper-input hover:text-ink-secondary"
          >
            {t(locale, 'word.archiveShort')}
          </button>
        )}
        <button
          onClick={onDelete}
          title={t(locale, 'word.delete')}
          className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-border bg-transparent text-xs font-semibold text-muted transition hover:border-cinnabar-border hover:bg-cinnabar-light hover:text-cinnabar"
        >
          {t(locale, 'word.deleteShort')}
        </button>
      </div>
    </div>
  );
}
