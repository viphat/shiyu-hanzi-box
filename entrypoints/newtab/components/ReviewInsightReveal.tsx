import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { UiLocale, WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { DefinitionList } from './DefinitionList';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

export function ReviewInsightReveal({ word, locale }: { word: WordEntry; locale: UiLocale }) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
      >
        {t(locale, 'review.showDefinitions')}
      </button>
    );
  }

  return <RevealedReviewInsight word={word} locale={locale} />;
}

function RevealedReviewInsight({ word, locale }: { word: WordEntry; locale: UiLocale }) {
  const { insight, loading } = useWordInsight(word);

  if (loading || !insight) {
    return <p className="mt-3 text-xs text-muted">{t(locale, 'insight.loading')}</p>;
  }

  const topExamples = insight.examples.slice(0, 2);

  return (
    <div className="mt-3 space-y-2">
      <ToneChips chips={insight.toneChips} />
      <DefinitionList
        title={t(locale, 'insight.definitions')}
        entries={insight.exactEntries.length > 0 ? insight.exactEntries : insight.componentEntries}
        locale={locale}
      />
      {word.note && (
        <p className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {word.note}
        </p>
      )}
      <SourceExamples examples={topExamples} externalLinks={[]} locale={locale} />
    </div>
  );
}
