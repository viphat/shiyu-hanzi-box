import { useEffect, useState } from 'react';
import { fetchAiTranslation } from '@/lib/ai/client';
import { requestAiSettingsPermission } from '@/lib/ai/permissions';
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings';
import { fetchGoogleTranslation } from '@/lib/translate/google';
import { requestGoogleTranslatePermission } from '@/lib/translate/permissions';
import type { TranslateResult } from '@/lib/translate/types';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import type { TranslateSlot } from '../components/TranslateButtons';
import type { AiQuoteTranslation, AiSettings, QuoteEntry, QuoteTranslation } from '@/lib/types';

const IDLE: TranslateSlot = { state: 'idle' };

export function useQuoteTranslation(quote: QuoteEntry) {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [google, setGoogle] = useState<TranslateSlot>(IDLE);
  const [ai, setAi] = useState<TranslateSlot>({
    state: 'disabled',
    failure: 'not-configured',
  });

  // The Google slot needs no configuration, so it starts idle. The AI slot
  // starts disabled and only opens once configured settings are read.
  useEffect(() => {
    let alive = true;
    getAiSettings()
      .then((next) => {
        if (!alive) return;
        setSettings(next);
        setAi(
          isAiConfigured(next) ? IDLE : { state: 'disabled', failure: 'not-configured' },
        );
      })
      .catch(() => {
        if (!alive) return;
        setAi({ state: 'disabled', failure: 'not-configured' });
      });
    return () => {
      alive = false;
    };
  }, []);

  /**
   * Send one targeted slot patch. This is an atomic background mutation
   * (applyQuoteTranslation runs inside the shared sync mutation chain), so
   * the read and write happen together and can't straddle a concurrent
   * note/tag/status edit or capture — no whole-inbox read here at all.
   */
  async function persistSlot(slot: 'google' | 'ai', value: QuoteTranslation | AiQuoteTranslation) {
    await requestSyncMutation('quoteTranslation', { quoteId: quote.id, slot, value });
  }

  function applyFailure(
    set: (slot: TranslateSlot) => void,
    result: Extract<TranslateResult, { ok: false }>,
  ) {
    set({ state: 'error', failure: result.code, detail: result.detail });
  }

  // Both functions resolve to the generated text so the card can show the line
  // immediately, before the persisted inbox re-render arrives. null on failure.
  async function translateGoogle(): Promise<string | null> {
    setGoogle({ state: 'loading' });
    try {
      const granted = await requestGoogleTranslatePermission();
      if (!granted) {
        setGoogle({ state: 'error', failure: 'permission-denied' });
        return null;
      }

      const result = await fetchGoogleTranslation({ text: quote.text });
      if (!result.ok) {
        applyFailure(setGoogle, result);
        return null;
      }

      const slot: QuoteTranslation = { text: result.text, generatedAt: Date.now() };
      await persistSlot('google', slot);
      setGoogle(IDLE);
      return slot.text;
    } catch {
      setGoogle({ state: 'error', failure: 'unreachable' });
      return null;
    }
  }

  async function translateAi(): Promise<string | null> {
    if (!settings || !isAiConfigured(settings)) {
      setAi({ state: 'disabled', failure: 'not-configured' });
      return null;
    }

    setAi({ state: 'loading' });
    try {
      const granted = await requestAiSettingsPermission(settings);
      if (!granted) {
        setAi({ state: 'error', failure: 'permission-denied' });
        return null;
      }

      const result = await fetchAiTranslation({
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        provider: settings.provider,
        quoteText: quote.text,
      });
      if (!result.ok) {
        applyFailure(setAi, result);
        return null;
      }

      const slot: AiQuoteTranslation = {
        text: result.text,
        generatedAt: Date.now(),
        provider: settings.provider,
        model: settings.model,
        baseUrl: settings.baseUrl,
      };
      await persistSlot('ai', slot);
      setAi(IDLE);
      return slot.text;
    } catch {
      setAi({ state: 'error', failure: 'unreachable' });
      return null;
    }
  }

  return { google, ai, translateGoogle, translateAi };
}
