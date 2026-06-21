import { useEffect, useMemo, useState } from 'react';
import { loadDictionary } from '@/lib/dictionary-loader';
import { computeWordInsight } from '@/lib/word-insight';
import type { DictionaryIndex, WordEntry, WordInsight } from '@/lib/types';

type LoadState =
  | { phase: 'loading'; index: null }
  | { phase: 'ready'; index: DictionaryIndex | null };

let sessionLoad: Promise<LoadState> | null = null;

async function ensureLoaded(): Promise<LoadState> {
  if (!sessionLoad) {
    sessionLoad = loadDictionary().then((result) => ({
      phase: 'ready' as const,
      index: result.index,
    }));
  }
  return sessionLoad;
}

export function useWordInsight(word: WordEntry): {
  insight: WordInsight | null;
  loading: boolean;
} {
  const [state, setState] = useState<LoadState>({ phase: 'loading', index: null });

  useEffect(() => {
    let cancelled = false;
    ensureLoaded().then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const insight = useMemo(
    () => (state.phase === 'ready' ? computeWordInsight(word, state.index) : null),
    [word, state],
  );

  return { insight, loading: state.phase === 'loading' };
}
