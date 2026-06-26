import { useEffect, useState } from 'react';
import { fetchClozeSuggestions } from '@/lib/ai/client';
import { suggestionsToCandidates, type ClozeCandidate } from '@/lib/ai/cloze-parse';
import { requestAiSettingsPermission } from '@/lib/ai/permissions';
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings';
import type { AiSettings, QuoteEntry } from '@/lib/types';

export type ClozeAiState = 'checking' | 'idle' | 'loading' | 'disabled' | 'error';

export function useClozeSuggestions(quote: QuoteEntry) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [state, setState] = useState<ClozeAiState>('checking');
  const [error, setError] = useState('');
  const [candidates, setCandidates] = useState<ClozeCandidate[] | null>(null);

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

  async function requestSuggestions() {
    if (!settings || !isAiConfigured(settings)) {
      setState('disabled');
      setError('Configure AI to use this.');
      return;
    }
    setState('loading');
    setError('');
    setCandidates(null);
    try {
      const granted = await requestAiSettingsPermission(settings);
      if (!granted) {
        setState('error');
        setError('Permission denied for AI provider.');
        return;
      }
      const result = await fetchClozeSuggestions({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        provider: settings.provider,
        quoteText: quote.text,
      });
      if (!result.ok) {
        setState('error');
        setError(result.reason);
        return;
      }
      setCandidates(suggestionsToCandidates(quote.text, result.suggestions, quote.clozes ?? []));
      setState('idle');
    } catch {
      setState('error');
      setError('Provider unreachable; retry.');
    }
  }

  function dismissCandidate(id: string) {
    setCandidates((prev) => (prev ? prev.filter((c) => c.cloze.id !== id) : prev));
  }

  return { state, error, candidates, requestSuggestions, dismissCandidate };
}
