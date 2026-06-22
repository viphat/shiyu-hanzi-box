import { useEffect, useState } from 'react';
import { fetchAiInsight, type AiClientResult } from '@/lib/ai/client';
import { buildMessages } from '@/lib/ai/prompt';
import { getAiSettings } from '@/lib/ai/settings';
import { mutateInbox } from '@/lib/storage';
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

function isConfigured(settings: AiSettings): boolean {
  return (
    settings.enabled &&
    settings.apiKey.trim() !== '' &&
    settings.baseUrl.trim() !== '' &&
    settings.model.trim() !== ''
  );
}

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
        if (isConfigured(next)) {
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
    if (!settings || !isConfigured(settings)) {
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
      await mutateInbox((inbox) => ({
        ...inbox,
        words: inbox.words.map((current) =>
          current.id === word.id
            ? { ...current, aiInsight: insight, updatedAt: Date.now() }
            : current,
        ),
      }));

      setState('idle');
    } catch {
      setState('error');
      setError('Provider unreachable; retry.');
    }
  }

  return { state, error, requestInsight };
}
