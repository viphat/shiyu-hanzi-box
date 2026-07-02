import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { UiLocale, WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { DefinitionList } from './DefinitionList';
import { SpeakButton } from './SpeakButton';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

export function ReviewInsightReveal({
  word,
  locale,
  initiallyRevealed = false,
}: {
  word: WordEntry;
  locale: UiLocale;
  initiallyRevealed?: boolean;
}) {
  const [revealed, setRevealed] = useState(initiallyRevealed);

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-accent-border hover:text-accent-deep"
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
      <SpeakButton text={word.text} locale={locale} />
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
      {word.aiInsight && (
        <div className="space-y-1.5 rounded-sm border border-accent-fade bg-paper-light p-3">
          <p className="text-[11px] font-medium uppercase tracking-[2px] text-accent-deep">AI 释义</p>
          <p className="text-sm text-ink">{word.aiInsight.summary}</p>
          {word.aiInsight.definitions.map((definition) => (
            <p key={definition} className="text-xs text-ink-secondary">
              {definition}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
