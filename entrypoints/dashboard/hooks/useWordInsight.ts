import { useEffect, useMemo, useState } from 'react';
import { loadDictionary } from '@/lib/dictionary-loader';
import { computeWordInsight } from '@/lib/word-insight';
import type { DictionaryIndexes, WordEntry, WordInsight } from '@/lib/types';

type LoadState =
  | { phase: 'loading'; indexes: null; cvdictEnabled: false }
  | { phase: 'ready'; indexes: DictionaryIndexes; cvdictEnabled: boolean };

const sessionLoads = new Map<string, Promise<LoadState>>();

async function ensureLoaded(cacheKey: string): Promise<LoadState> {
  let load = sessionLoads.get(cacheKey);
  if (!load) {
    load = loadDictionary().then((result) => ({
      phase: 'ready' as const,
      indexes: result.indexes,
      cvdictEnabled: result.cvdictEnabled,
    }));
    sessionLoads.set(cacheKey, load);
  }
  return load;
}

export function useWordInsight(word: WordEntry, dictionaryCacheKey = 'default'): {
  insight: WordInsight | null;
  loading: boolean;
} {
  const [state, setState] = useState<LoadState>({
    phase: 'loading',
    indexes: null,
    cvdictEnabled: false,
  });

  useEffect(() => {
    let cancelled = false;
    setState({ phase: 'loading', indexes: null, cvdictEnabled: false });
    ensureLoaded(dictionaryCacheKey).then((loaded) => {
      if (!cancelled) setState(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [dictionaryCacheKey]);

  const insight = useMemo(
    () => (
      state.phase === 'ready'
        ? computeWordInsight(word, state.indexes, state.cvdictEnabled)
        : null
    ),
    [word, state],
  );

  return { insight, loading: state.phase === 'loading' };
}
