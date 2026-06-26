import { type RefObject } from 'react';
import { clozeFromRange, clozesOverlap } from '@/lib/cloze';
import { resolveSelectionOffsets } from '@/lib/cloze-selection';
import { t } from '@/lib/i18n';
import type { Cloze, QuoteEntry, UiLocale } from '@/lib/types';

interface ClozeEditorProps {
  quote: QuoteEntry;
  onChange: (clozes: Cloze[]) => void;
  onUpdate: (patch: Partial<QuoteEntry>) => void;
  locale: UiLocale;
  /** Ref to the span that renders this quote's text (for drag-select). */
  quoteTextRef?: RefObject<HTMLElement | null>;
}

export function ClozeEditor({ quote, onChange, onUpdate, locale, quoteTextRef }: ClozeEditorProps) {
  const clozes = quote.clozes ?? [];

  // ---------------------------------------------------------------------------
  // Chips: existing clozes
  // ---------------------------------------------------------------------------

  function removeCloze(id: string) {
    onChange(clozes.filter((c) => c.id !== id));
  }

  function changeHint(id: string, hint: Cloze['hint']) {
    // When the user picks "none" store undefined (unset = none convention).
    const normalised: Cloze['hint'] = hint === 'none' ? undefined : hint;
    onChange(clozes.map((c) => (c.id === id ? { ...c, hint: normalised } : c)));
  }

  // ---------------------------------------------------------------------------
  // Manual drag-select: "Add blank" maps the current selection (constrained to
  // THIS card's quote span) back to character offsets, then validates it.
  // ---------------------------------------------------------------------------

  function handleAddBlank() {
    const sel = window.getSelection();
    const quoteSpan = quoteTextRef?.current;
    if (!sel || !quoteSpan) return;

    // Offsets are resolved against this editor's own span, so a selection that
    // strays into a sibling card (or anywhere else) resolves to null.
    const offsets = resolveSelectionOffsets(sel, quoteSpan);
    if (!offsets) {
      sel.removeAllRanges();
      return;
    }

    const cloze = clozeFromRange(quote.text, offsets.start, offsets.end, clozes);
    if (!cloze) {
      sel.removeAllRanges();
      return;
    }

    const next = [...clozes, cloze].sort((a, b) => a.start - b.start);
    onChange(next);
    sel.removeAllRanges();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="mt-3 space-y-2">
      {/* Existing cloze chips */}
      {clozes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {clozes.map((cloze) => (
            <ClozeChip
              key={cloze.id}
              cloze={cloze}
              text={quote.text}
              locale={locale}
              onRemove={() => removeCloze(cloze.id)}
              onChangeHint={(hint) => changeHint(cloze.id, hint)}
            />
          ))}
        </div>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          title={t(locale, 'cloze.addBlank')}
          onClick={handleAddBlank}
          className="rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
        >
          {t(locale, 'cloze.addBlank')}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ClozeChip sub-component
// ---------------------------------------------------------------------------

function ClozeChip({
  cloze,
  text,
  locale,
  onRemove,
  onChangeHint,
}: {
  cloze: Cloze;
  text: string;
  locale: UiLocale;
  onRemove: () => void;
  onChangeHint: (hint: Cloze['hint']) => void;
}) {
  const spanText = text.slice(cloze.start, cloze.end);

  return (
    <div className="flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1">
      <span className="text-xs font-medium text-cinnabar">{spanText}</span>
      <select
        value={cloze.hint ?? 'none'}
        onChange={(e) => onChangeHint(e.target.value as Cloze['hint'])}
        className="rounded-sm border border-cinnabar-border bg-paper-input px-1 py-0.5 text-xs text-ink outline-none"
      >
        <option value="none">{t(locale, 'cloze.hintNone')}</option>
        <option value="pinyin">{t(locale, 'cloze.hintPinyin')}</option>
        <option value="length">{t(locale, 'cloze.hintLength')}</option>
      </select>
      <button
        type="button"
        title={t(locale, 'cloze.removeBlank')}
        data-cloze-id={cloze.id}
        onClick={onRemove}
        className="ml-1 rounded-sm px-1 text-xs text-muted transition hover:text-cinnabar"
      >
        {t(locale, 'cloze.removeBlank')}
      </button>
    </div>
  );
}
