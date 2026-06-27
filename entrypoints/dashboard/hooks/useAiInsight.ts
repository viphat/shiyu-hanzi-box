import { useEffect, useState } from 'react';
import { fetchAiInsight, type AiClientResult } from '@/lib/ai/client';
import { buildMessages } from '@/lib/ai/prompt';
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings';
import { inboxStorage } from '@/lib/storage';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import type {
  AiInsight,
  AiSettings,
  DictionaryEntry,
  Occurrence,
  WordEntry,
} from '@/lib/types';

export type AiRequestState =
  | 'checking'
  | 'idle'
  | 'loading'
  | 'disabled'
  | 'error';

function newestOccurrence(word: WordEntry): Occurrence | undefined {
  return [...word.occurrences].sort((a, b) => b.capturedAt - a.capturedAt)[0];
}

export function useAiInsight(word: WordEntry, cedictEntries: DictionaryEntry[]) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [state, setState] = useState<AiRequestState>('checking');
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;

    getAiSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        if (isAiConfigured(next)) {
          setState('idle');
          setError('');
        } else {
          setState('disabled');
          setError('Configure AI to use this.');
        }
      })
      .catch(() => {
        if (!alive) return;
        setState('disabled');
        setError('Configure AI to use this.');
      });

    return () => {
      alive = false;
    };
  }, []);

  async function requestInsight() {
    if (!settings || !isAiConfigured(settings)) {
      setState('disabled');
      setError('Configure AI to use this.');
      return;
    }

    setState('loading');
    setError('');

    try {
      const result: AiClientResult = await fetchAiInsight({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: buildMessages(
          word,
          word.pinyin,
          cedictEntries,
          newestOccurrence(word),
        ),
        provider: settings.provider,
      });

      if (!result.ok) {
        setState('error');
        setError(result.reason);
        return;
      }

      const insight: AiInsight = result.value;
      const cur = await inboxStorage.getValue();
      await requestSyncMutation('inbox', {
        ...cur,
        words: cur.words.map((current) =>
          current.id === word.id
            ? { ...current, aiInsight: insight, updatedAt: Date.now() }
            : current,
        ),
      });

      setState('idle');
    } catch {
      setState('error');
      setError('Provider unreachable; retry.');
    }
  }

  return { state, error, requestInsight };
}
