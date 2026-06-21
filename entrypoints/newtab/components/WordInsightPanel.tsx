import type { WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { DefinitionList } from './DefinitionList';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

/**
 * Owns the `useWordInsight` hook call so the parent `WordCard` does not call
 * a hook conditionally. The hook loads the dictionary once per dashboard
 * session, so mounting this for an expanded card is cheap after the first.
 */
export function WordInsightPanel({ word }: { word: WordEntry }) {
  const { insight, loading } = useWordInsight(word);

  if (loading) {
    return <p className="text-xs text-muted">正在翻字典…</p>;
  }
  if (!insight) return null;

  return (
    <div className="space-y-3">
      <ToneChips chips={insight.toneChips} />

      {insight.status === 'ready' && (
        <DefinitionList title="释义" entries={insight.exactEntries} />
      )}

      {insight.status === 'no-definition' && insight.componentEntries.length > 0 && (
        <DefinitionList title="单字释义" entries={insight.componentEntries} />
      )}

      {insight.status === 'no-definition' && insight.componentEntries.length === 0 && (
        <p className="text-xs text-muted">暂无本地释义，可点下方链接查询。</p>
      )}

      {insight.status === 'dictionary-unavailable' && (
        <p className="text-xs text-muted">字典暂不可用。</p>
      )}

      <SourceExamples examples={insight.examples} externalLinks={insight.externalLinks} />
      <a
        href="https://www.mdbg.net/chinese/dictionary?page=cc-cedict"
        target="_blank"
        rel="noreferrer"
        className="inline-block text-[10px] text-muted hover:text-cinnabar"
      >
        Dictionary: CC-CEDICT
      </a>
    </div>
  );
}
