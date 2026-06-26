import { useState } from 'react';
import { clozeFromRange, clozesOverlap, suggestClozes } from '@/lib/cloze';
import { t } from '@/lib/i18n';
import type { Cloze, QuoteEntry, UiLocale, WordEntry } from '@/lib/types';

interface ClozeEditorProps {
  quote: QuoteEntry;
  savedWords: WordEntry[];
  onChange: (clozes: Cloze[]) => void;
  locale: UiLocale;
}

export function ClozeEditor({ quote, savedWords, onChange, locale }: ClozeEditorProps) {
  const clozes = quote.clozes ?? [];
  const [suggestions, setSuggestions] = useState<Cloze[] | null>(null);

  // ---------------------------------------------------------------------------
  // Chips: existing clozes
  // ---------------------------------------------------------------------------

  function removeCloze(id: string) {
    onChange(clozes.filter((c) => c.id !== id));
  }

  function changeHint(id: string, hint: Cloze['hint']) {
    onChange(clozes.map((c) => (c.id === id ? { ...c, hint } : c)));
  }

  // ---------------------------------------------------------------------------
  // Suggest blanks
  // ---------------------------------------------------------------------------

  function handleSuggest() {
    const all = suggestClozes(quote.text, savedWords);
    // Filter to spans not already present (match on [start, end))
    const filtered = all.filter(
      (s) => !clozes.some((c) => c.start === s.start && c.end === s.end),
    );
    setSuggestions(filtered);
  }

  function acceptSuggestion(suggestion: Cloze) {
    // Double-check it still doesn't overlap with current clozes
    if (clozesOverlap([...clozes, suggestion])) return;
    const next = [...clozes, suggestion].sort((a, b) => a.start - b.start);
    onChange(next);
    setSuggestions((prev) =>
      prev ? prev.filter((s) => s.id !== suggestion.id) : null,
    );
  }

  // ---------------------------------------------------------------------------
  // Manual drag-select: "Add blank" button reads window.getSelection()
  // ---------------------------------------------------------------------------

  function handleAddBlank() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) return;

    // The quote text node is rendered inside a <span data-quote-text>.
    // Walk up from anchorNode to find if it's inside that span.
    const anchorNode = sel.anchorNode;
    const focusNode = sel.focusNode;
    if (!anchorNode || !focusNode) return;

    // Both anchor and focus must be inside a text node that is a child of the
    // [data-quote-text] span (or that span itself).
    function offsetInQuoteText(node: Node, offset: number): number | null {
      // Check if node is a Text node whose parent has [data-quote-text]
      if (
        node.nodeType === Node.TEXT_NODE &&
        (node.parentElement?.hasAttribute('data-quote-text') ?? false)
      ) {
        return offset;
      }
      // Check if node itself is the [data-quote-text] span
      if (
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).hasAttribute('data-quote-text')
      ) {
        return offset;
      }
      return null;
    }

    const startOffset = offsetInQuoteText(anchorNode, sel.anchorOffset);
    const endOffset = offsetInQuoteText(focusNode, sel.focusOffset);

    if (startOffset === null || endOffset === null) return;

    const cloze = clozeFromRange(quote.text, startOffset, endOffset, clozes);
    if (!cloze) return;

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

      {/* Suggestions panel */}
      {suggestions !== null && (
        <div className="rounded-sm border border-cinnabar-border bg-cinnabar-light p-2">
          {suggestions.length === 0 ? (
            <p className="text-xs text-muted">{t(locale, 'cloze.noSuggestions')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {suggestions.map((s) => (
                <div key={s.id} className="flex items-center gap-1">
                  <span className="rounded-sm border border-cinnabar-border px-2 py-0.5 text-xs text-cinnabar">
                    {quote.text.slice(s.start, s.end)}
                  </span>
                  <button
                    type="button"
                    onClick={() => acceptSuggestion(s)}
                    className="rounded-sm border border-cinnabar-border bg-cinnabar px-2 py-0.5 text-xs text-white transition hover:bg-cinnabar/80"
                  >
                    {t(locale, 'cloze.accept')}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Actions row */}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleSuggest}
          className="rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 text-xs text-cinnabar transition hover:bg-cinnabar hover:text-white"
        >
          {t(locale, 'cloze.suggestBlanks')}
        </button>
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
        onClick={onRemove}
        className="ml-1 rounded-sm px-1 text-xs text-muted transition hover:text-cinnabar"
      >
        {t(locale, 'cloze.removeBlank')}
      </button>
    </div>
  );
}
