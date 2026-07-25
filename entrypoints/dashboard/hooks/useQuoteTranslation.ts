import { useEffect, useState } from 'react';
import { fetchAiTranslation } from '@/lib/ai/client';
import { getAiSettings, isAiConfigured } from '@/lib/ai/settings';
import { fetchGoogleTranslation } from '@/lib/translate/google';
import { requestGoogleTranslatePermission } from '@/lib/translate/permissions';
import type { TranslateResult } from '@/lib/translate/types';
import { inboxStorage } from '@/lib/storage';
import { requestSyncMutation } from '@/entrypoints/background/sync-mutation-handler';
import type { TranslateSlot } from '../components/TranslateButtons';
import type {
  AiQuoteTranslation,
  AiSettings,
  QuoteEntry,
  QuoteTranslation,
  QuoteTranslations,
} from '@/lib/types';

const IDLE: TranslateSlot = { state: 'idle' };

// Module scope, above the hook — shared across every card so two cards racing
// cannot clobber each other either.
let writeChain: Promise<unknown> = Promise.resolve();

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
   * Merge one slot into this quote's translations and write the inbox through
   * the sync coordinator. Reads storage fresh so a concurrent edit to another
   * quote is not clobbered, and spreads the existing `translations` so the
   * sibling slot always survives.
   */
  async function persistSlot(patch: Partial<QuoteTranslations>) {
    // Reads must not overlap writes: requestSyncMutation resolves only after
    // the background worker's setInbox, so an unserialized second read can
    // capture a pre-write snapshot and erase the sibling slot.
    const run = writeChain.then(async () => {
      const current = await inboxStorage.getValue();
      await requestSyncMutation('inbox', {
        ...current,
        quotes: current.quotes.map((candidate) =>
          candidate.id === quote.id
            ? {
                ...candidate,
                translations: { ...candidate.translations, ...patch },
                updatedAt: Date.now(),
              }
            : candidate,
        ),
      });
    });
    writeChain = run.catch(() => {});
    return run;
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
      await persistSlot({ google: slot });
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
      await persistSlot({ ai: slot });
      setAi(IDLE);
      return slot.text;
    } catch {
      setAi({ state: 'error', failure: 'unreachable' });
      return null;
    }
  }

  return { google, ai, translateGoogle, translateAi };
}
