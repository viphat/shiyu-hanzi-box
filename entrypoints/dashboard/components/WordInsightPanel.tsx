import { t } from '@/lib/i18n';
import type { AppSettings, UiLocale, WordEntry } from '@/lib/types';
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
export function WordInsightPanel({
  word,
  locale,
  dictionaryCacheKey = 'default',
  dictionarySettings,
}: {
  word: WordEntry;
  locale: UiLocale;
  dictionaryCacheKey?: string;
  dictionarySettings?: AppSettings;
}) {
  const { insight, loading } = useWordInsight(word, dictionaryCacheKey, dictionarySettings);
  const { english, vietnamese } = useAiInsight(
    word,
    insight?.exactEntries ?? [],
    insight?.vietnamese.exactEntries ?? [],
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

      {insight.vietnamese.status === 'ready' && insight.vietnamese.exactEntries.length > 0 && (
        <DefinitionList
          title={t(locale, 'insight.vietnameseDefinitions')}
          entries={insight.vietnamese.exactEntries}
          locale={locale}
          showPinyin={false}
        />
      )}

      {insight.vietnamese.status === 'no-definition' && insight.vietnamese.componentEntries.length > 0 && (
        <DefinitionList
          title={t(locale, 'insight.vietnameseDefinitions')}
          entries={insight.vietnamese.componentEntries}
          locale={locale}
          showPinyin={false}
        />
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
        <div className="flex flex-wrap gap-2">
          <AskAiButton
            state={english.state}
            error={english.state === 'disabled' ? t(locale, 'ai.configure') : english.error}
            label={t(locale, 'ai.askEnglish')}
            checkingLabel={t(locale, 'ai.checking')}
            loadingLabel={t(locale, 'ai.generating')}
            retryLabel={t(locale, 'ai.retry')}
            disabledDescription={t(locale, 'ai.configure')}
            onAsk={english.request}
            onRetry={english.request}
          />
          <AskAiButton
            state={vietnamese.state}
            error={vietnamese.state === 'disabled' ? t(locale, 'ai.configure') : vietnamese.error}
            label={t(locale, 'ai.askVietnamese')}
            checkingLabel={t(locale, 'ai.checking')}
            loadingLabel={t(locale, 'ai.generating')}
            retryLabel={t(locale, 'ai.retry')}
            disabledDescription={t(locale, 'ai.configure')}
            onAsk={vietnamese.request}
            onRetry={vietnamese.request}
          />
        </div>
        {word.aiInsight && (
          <div className="mt-2">
            <AiInsightSection
              title={t(locale, 'ai.englishTitle')}
              insight={word.aiInsight}
              onRegenerate={english.request}
              regenerateTitle={t(locale, 'ai.regenerate')}
              generatedByLabel={t(locale, 'ai.generatedBy')}
            />
          </div>
        )}
        {word.aiVietnameseInsight && (
          <div className="mt-2">
            <AiInsightSection
              title={t(locale, 'ai.vietnameseTitle')}
              insight={word.aiVietnameseInsight}
              onRegenerate={vietnamese.request}
              regenerateTitle={t(locale, 'ai.regenerate')}
              generatedByLabel={t(locale, 'ai.generatedBy')}
            />
          </div>
        )}
      </div>
    </div>
  );
}
