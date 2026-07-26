import { RefreshCw } from 'lucide-react';
import type { AiInsight, VietnameseAiInsight } from '@/lib/types';

export function AiInsightSection({
  title,
  insight,
  onRegenerate,
  regenerateTitle,
  generatedByLabel,
}: {
  title: string;
  insight: AiInsight | VietnameseAiInsight;
  onRegenerate?: () => void;
  regenerateTitle?: string;
  generatedByLabel: string;
}) {
  return (
    <div className="space-y-2 rounded-sm border border-accent-fade bg-paper-light p-3">
      <div className="flex items-center justify-between">
        <p className="text-[11px] font-medium uppercase tracking-[2px] text-accent-deep">
          {title}
        </p>
        {onRegenerate && (
          <button
            onClick={onRegenerate}
            title={regenerateTitle}
            className="rounded-sm p-1 text-muted transition hover:bg-paper-input hover:text-accent-deep"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        )}
      </div>

      {insight.summary && <p className="text-sm text-ink">{insight.summary}</p>}

      {insight.register && (
        <span className="inline-block rounded-sm border border-border bg-paper-input px-1.5 py-0.5 text-[11px] text-muted">
          {insight.register}
        </span>
      )}

      {insight.definitions.length > 0 && (
        <ul className="space-y-1">
          {insight.definitions.map((definition) => (
            <li key={definition} className="text-xs leading-5 text-ink-secondary">
              {definition}
            </li>
          ))}
        </ul>
      )}

      {insight.sampleSentences.map((sentence, index) => (
        <div key={`${sentence}-${index}`} className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
          <p className="text-xs leading-5 text-ink-secondary">{sentence}</p>
          {insight.translations[index] && (
            <p className="mt-0.5 text-xs text-muted">{insight.translations[index]}</p>
          )}
        </div>
      ))}

      {insight.collocations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {insight.collocations.map((collocation) => (
            <span
              key={collocation}
              className="rounded-sm border border-border bg-paper-input px-1.5 py-0.5 text-[11px] text-muted"
            >
              {collocation}
            </span>
          ))}
        </div>
      )}

      {insight.notes && <p className="text-xs leading-5 text-muted">{insight.notes}</p>}

      <p className="text-[10px] text-muted">
        {generatedByLabel} {insight.model} · {new Date(insight.generatedAt).toLocaleString()}
      </p>
    </div>
  );
}
