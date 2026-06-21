import { useState } from 'react';
import type { WordEntry } from '@/lib/types';
import { useWordInsight } from '../hooks/useWordInsight';
import { DefinitionList } from './DefinitionList';
import { SourceExamples } from './SourceExamples';
import { ToneChips } from './ToneChips';

export function ReviewInsightReveal({ word }: { word: WordEntry }) {
  const [revealed, setRevealed] = useState(false);

  if (!revealed) {
    return (
      <button
        onClick={() => setRevealed(true)}
        className="mt-3 inline-flex items-center gap-1 rounded-sm border border-border bg-paper-input px-2 py-1 text-xs text-muted transition hover:border-cinnabar-border hover:text-cinnabar"
      >
        显示释义
      </button>
    );
  }

  return <RevealedReviewInsight word={word} />;
}

function RevealedReviewInsight({ word }: { word: WordEntry }) {
  const { insight, loading } = useWordInsight(word);

  if (loading || !insight) {
    return <p className="mt-3 text-xs text-muted">正在翻字典…</p>;
  }

  const topExamples = insight.examples.slice(0, 2);

  return (
    <div className="mt-3 space-y-2">
      <ToneChips chips={insight.toneChips} />
      <DefinitionList
        title="释义"
        entries={insight.exactEntries.length > 0 ? insight.exactEntries : insight.componentEntries}
      />
      {word.note && (
        <p className="rounded-sm border border-border bg-paper-input px-3 py-2 text-sm leading-6 text-ink-secondary">
          {word.note}
        </p>
      )}
      <SourceExamples examples={topExamples} externalLinks={[]} />
    </div>
  );
}
