import { useState } from 'react';
import { t } from '@/lib/i18n';
import type { AppSettings, UiLocale, WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { AiInsightSection } from './AiInsightSection';
import { DefinitionList } from './DefinitionList';
import { SpeakButton } from './SpeakButton';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

export function ReviewInsightReveal({
  word,
  locale,
  initiallyRevealed = false,
  dictionaryCacheKey = 'default',
  dictionarySettings,
}: {
  word: WordEntry;
  locale: UiLocale;
  initiallyRevealed?: boolean;
  dictionaryCacheKey?: string;
  dictionarySettings?: AppSettings;
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

  return (
    <RevealedReviewInsight
      word={word}
      locale={locale}
      dictionaryCacheKey={dictionaryCacheKey}
      dictionarySettings={dictionarySettings}
    />
  );
}

function RevealedReviewInsight({
  word,
  locale,
  dictionaryCacheKey,
  dictionarySettings,
}: {
  word: WordEntry;
  locale: UiLocale;
  dictionaryCacheKey: string;
  dictionarySettings?: AppSettings;
}) {
  const { insight, loading } = useWordInsight(word, dictionaryCacheKey, dictionarySettings);

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
        <AiInsightSection
          title={t(locale, 'ai.englishTitle')}
          insight={word.aiInsight}
          generatedByLabel={t(locale, 'ai.generatedBy')}
        />
      )}
      {word.aiVietnameseInsight && (
        <AiInsightSection
          title={t(locale, 'ai.vietnameseTitle')}
          insight={word.aiVietnameseInsight}
          generatedByLabel={t(locale, 'ai.generatedBy')}
        />
      )}
    </div>
  );
}
