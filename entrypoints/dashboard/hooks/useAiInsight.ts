import { useEffect, useState } from 'react';
import { fetchAiInsight, type AiClientResult } from '@/lib/ai/client';
import { requestAiSettingsPermission } from '@/lib/ai/permissions';
import { buildWordInsightMessages } from '@/lib/ai/prompt';
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import type {
  AiInsight,
  AiInsightLanguage,
  AiSettings,
  DictionaryEntry,
  Occurrence,
  VietnameseAiInsight,
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

export function useAiInsight(
  word: WordEntry,
  englishEntries: DictionaryEntry[],
  vietnameseEntries: DictionaryEntry[] = [],
) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [englishState, setEnglishState] = useState<AiRequestState>('checking');
  const [englishError, setEnglishError] = useState('');
  const [vietnameseState, setVietnameseState] = useState<AiRequestState>('checking');
  const [vietnameseError, setVietnameseError] = useState('');

  useEffect(() => {
    let alive = true;

    getAiSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        if (isAiConfigured(next)) {
          setEnglishState('idle');
          setEnglishError('');
          setVietnameseState('idle');
          setVietnameseError('');
        } else {
          setEnglishState('disabled');
          setEnglishError('Configure AI to use this.');
          setVietnameseState('disabled');
          setVietnameseError('Configure AI to use this.');
        }
      })
      .catch(() => {
        if (!alive) return;
        setEnglishState('disabled');
        setEnglishError('Configure AI to use this.');
        setVietnameseState('disabled');
        setVietnameseError('Configure AI to use this.');
      });

    return () => {
      alive = false;
    };
  }, []);

  async function requestInsight(language: AiInsightLanguage) {
    const setState = language === 'en' ? setEnglishState : setVietnameseState;
    const setError = language === 'en' ? setEnglishError : setVietnameseError;
    if (!settings || !isAiConfigured(settings)) {
      setState('disabled');
      setError('Configure AI to use this.');
      return;
    }

    setState('loading');
    setError('');

    try {
      const granted = await requestAiSettingsPermission(settings);
      if (!granted) {
        setState('error');
        setError('Permission denied for AI provider.');
        return;
      }

      const result: AiClientResult = await fetchAiInsight({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: buildWordInsightMessages({
          word,
          language,
          pinyin: word.pinyin,
          englishEntries,
          vietnameseEntries,
          recentOccurrence: newestOccurrence(word),
        }),
        provider: settings.provider,
        language,
      });

      if (!result.ok) {
        setState('error');
        setError(result.reason);
        return;
      }

      const insight = result.value;
      if (language === 'vi') {
        await requestSyncMutation('wordAiInsight', {
          wordId: word.id,
          language,
          insight: insight as VietnameseAiInsight,
        });
      } else {
        await requestSyncMutation('wordAiInsight', {
          wordId: word.id,
          language,
          insight: insight as AiInsight,
        });
      }

      setState('idle');
    } catch {
      setState('error');
      setError('Provider unreachable; retry.');
    }
  }

  const requestEnglish = () => requestInsight('en');
  const requestVietnamese = () => requestInsight('vi');

  return {
    english: { state: englishState, error: englishError, request: requestEnglish },
    vietnamese: {
      state: vietnameseState,
      error: vietnameseError,
      request: requestVietnamese,
    },
    // Kept until Task 6 switches the existing panel to the two-slot UI.
    state: englishState,
    error: englishError,
    requestInsight: requestEnglish,
  };
}
