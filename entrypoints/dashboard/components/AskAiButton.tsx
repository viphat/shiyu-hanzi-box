import { Loader2, Sparkles } from 'lucide-react';
import type { AiRequestState } from '../hooks/useAiInsight';

export function AskAiButton({
  state,
  error,
  onAsk,
  onRetry,
}: {
  state: AiRequestState;
  error: string;
  onAsk: () => void;
  onRetry: () => void;
}) {
  if (state === 'checking' || state === 'disabled') {
    return (
      <div className="space-y-1">
        <button
          disabled
          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-muted opacity-60"
        >
          {state === 'checking' ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {state === 'checking' ? '检查 AI 设置...' : 'Ask AI'}
        </button>
        <p className="text-[11px] text-muted">
          {error || 'Configure AI to use this.'}
        </p>
      </div>
    );
  }

  const canClick = state === 'idle' || state === 'error';

  return (
    <div className="space-y-1">
      <button
        onClick={canClick ? (state === 'error' ? onRetry : onAsk) : undefined}
        disabled={!canClick}
        className={`inline-flex items-center gap-1.5 rounded-sm border px-2 py-1.5 text-xs transition ${
          state === 'error'
            ? 'border-accent-border bg-accent-light text-accent-deep hover:bg-accent hover:text-white'
            : 'border-border bg-paper-input text-muted hover:border-accent-border hover:text-accent-deep'
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {state === 'loading' ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Sparkles className="h-3 w-3" />
        )}
        {state === 'loading' ? '正在生成...' : state === 'error' ? '重试' : 'Ask AI'}
      </button>
      {state === 'error' && <p className="text-[11px] text-accent-deep">{error}</p>}
    </div>
  );
}
