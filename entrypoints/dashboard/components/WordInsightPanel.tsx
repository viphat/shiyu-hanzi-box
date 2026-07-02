import { t } from '@/lib/i18n';
import type { UiLocale, WordEntry } from '@/lib/types';
import { useAiInsight } from '../hooks/useAiInsight';
import { useWordInsight } from '../hooks/useWordInsight';
import { AiInsightSection } from './AiInsightSection';
import { AskAiButton } from './AskAiButton';
import { DefinitionList } from './DefinitionList';
import { SpeakButton } from './SpeakButton';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

/**
 * Owns the `useWordInsight` hook call so the parent `WordCard` does not call
 * a hook conditionally. The hook loads the dictionary once per dashboard
 * session, so mounting this for an expanded card is cheap after the first.
 */
export function WordInsightPanel({ word, locale }: { word: WordEntry; locale: UiLocale }) {
  const { insight, loading } = useWordInsight(word);
  const { state: aiState, error: aiError, requestInsight } = useAiInsight(
    word,
    insight?.exactEntries ?? [],
  );

  if (loading) {
    return <p className="text-xs text-muted">{t(locale, 'insight.loading')}</p>;
  }
  if (!insight) return null;

  return (
    <div className="space-y-3">
      <ToneChips chips={insight.toneChips} />
      <SpeakButton text={word.text} locale={locale} />

      {insight.status === 'ready' && (
        <DefinitionList title={t(locale, 'insight.definitions')} entries={insight.exactEntries} locale={locale} />
      )}

      {insight.status === 'no-definition' && insight.componentEntries.length > 0 && (
        <DefinitionList title={t(locale, 'insight.components')} entries={insight.componentEntries} locale={locale} />
      )}

      {insight.status === 'no-definition' && insight.componentEntries.length === 0 && (
        <p className="text-xs text-muted">{t(locale, 'insight.noLocalDefinition')}</p>
      )}

      {insight.status === 'dictionary-unavailable' && (
        <p className="text-xs text-muted">{t(locale, 'insight.dictionaryUnavailable')}</p>
      )}

      <SourceExamples examples={insight.examples} externalLinks={insight.externalLinks} locale={locale} />
      <a
        href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-[10px] text-muted hover:text-accent-deep"
      >
        {t(locale, 'dictionary.ccCedict')}
      </a>
      <div className="border-t border-border pt-3">
        <AskAiButton
          state={aiState}
          error={aiError}
          onAsk={requestInsight}
          onRetry={requestInsight}
        />
        {word.aiInsight && (
          <div className="mt-2">
            <AiInsightSection
              insight={word.aiInsight}
              onRegenerate={requestInsight}
            />
          </div>
        )}
      </div>
    </div>
  );
}
