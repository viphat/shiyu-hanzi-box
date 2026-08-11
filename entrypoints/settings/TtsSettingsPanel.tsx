import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { t } from '@/lib/i18n';
import {
  configureTts,
  getSelectedVoiceName,
  getTtsState,
  initTts,
  listVoiceCandidates,
  speak,
  subscribeTts,
  type TtsState,
} from '@/lib/tts';
import { MAX_TTS_RATE, MIN_TTS_RATE } from '@/lib/tts-voices';
import type { TtsSettings, UiLocale } from '@/lib/types';

export function TtsSettingsPanel({
  settings,
  locale,
  onSave,
}: {
  settings: TtsSettings;
  locale: UiLocale;
  onSave: (next: TtsSettings) => void;
}) {
  const [draft, setDraft] = useState<TtsSettings>({ ...settings });
  // Chrome resolves its voice list asynchronously. Without this subscription
  // the picker would render once, before any voice exists, and never update.
  const [, setTtsState] = useState<TtsState>(getTtsState);

  useEffect(() => {
    setDraft({
      voiceName: settings.voiceName,
      rate: settings.rate,
      allowNetworkVoices: settings.allowNetworkVoices,
    });
  }, [settings.voiceName, settings.rate, settings.allowNetworkVoices]);

  useEffect(() => {
    const unsubscribe = subscribeTts(setTtsState);
    setTtsState(initTts());
    return unsubscribe;
  }, []);

  // Preview the pending selection rather than the saved one. This module state
  // belongs to the settings page and never reaches the dashboard.
  useEffect(() => {
    configureTts(draft);
  }, [draft]);

  const voices = listVoiceCandidates();
  const hasNetworkVoice = voices.some((voice) => voice.isRemote);
  const effectiveVoiceName = getSelectedVoiceName();
  const savedVoiceNotInUse =
    draft.voiceName !== null && effectiveVoiceName !== draft.voiceName;

  function update(next: TtsSettings) {
    setDraft(next);
    onSave(next);
  }

  return (
    <section className="rounded-2xl border border-border bg-card p-4 shadow-[0_1px_3px_rgba(90,75,50,0.06)]">
      <div className="flex items-center gap-2">
        <Volume2 className="h-4 w-4 text-accent-deep" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-[2px]">{t(locale, 'tts.settingsTitle')}</h2>
      </div>

      {voices.length === 0 ? (
        <p className="mt-3 text-xs text-muted">{t(locale, 'tts.noVoices')}</p>
      ) : (
        <div className="mt-4 space-y-3">
          <div>
            <label
              htmlFor="tts-voice"
              className="mb-1 block text-[11px] font-medium text-muted"
            >
              {t(locale, 'tts.voice')}
            </label>
            <select
              id="tts-voice"
              value={draft.voiceName ?? ''}
              onChange={(event) =>
                update({ ...draft, voiceName: event.target.value || null })
              }
              className="w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-accent-fade"
            >
              <option value="">{t(locale, 'tts.voiceAuto')}</option>
              {voices.map((voice) => (
                <option
                  key={voice.name}
                  value={voice.name}
                  disabled={voice.isRemote && !draft.allowNetworkVoices}
                >
                  {voice.name}
                  {voice.isDefault ? ` · ${t(locale, 'tts.badgeSystem')}` : ''}
                  {voice.isRemote ? ` · ${t(locale, 'tts.badgeNetwork')}` : ''}
                </option>
              ))}
            </select>
            {savedVoiceNotInUse ? (
              <p className="mt-0.5 text-[10px] text-accent-deep">
                {t(locale, 'tts.voiceMissing')}
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="tts-rate"
              className="mb-1 block text-[11px] font-medium text-muted"
            >
              {t(locale, 'tts.rate')} · {draft.rate.toFixed(1)}×
            </label>
            <input
              id="tts-rate"
              type="range"
              min={MIN_TTS_RATE}
              max={MAX_TTS_RATE}
              step={0.1}
              value={draft.rate}
              onChange={(event) =>
                update({ ...draft, rate: Number(event.target.value) })
              }
              className="w-full"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={draft.allowNetworkVoices}
                onChange={(event) =>
                  update({ ...draft, allowNetworkVoices: event.target.checked })
                }
                className="rounded-sm"
              />
              {t(locale, 'tts.allowNetwork')}
            </label>
            <p className="mt-0.5 text-[10px] text-muted">
              {hasNetworkVoice
                ? t(locale, 'tts.allowNetworkHint')
                : t(locale, 'tts.noNetworkVoices')}
            </p>
          </div>

          <button
            type="button"
            onClick={() => speak(t(locale, 'tts.testSample'))}
            className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-1.5 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input"
          >
            <Volume2 className="h-3 w-3" /> {t(locale, 'tts.test')}
            {getSelectedVoiceName() ? ` · ${getSelectedVoiceName()}` : ''}
          </button>
        </div>
      )}
    </section>
  );
}
