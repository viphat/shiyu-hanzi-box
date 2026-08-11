import { Volume2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

  // The rate slider commits on release (pointerup/keyup/blur), not per drag
  // step. But unmounting mid-drag fires none of those — removing a focused
  // element from the DOM does not emit blur/focusout, so `document.
  // activeElement` silently moves to `<body>` instead. Track only the
  // uncommitted *rate* and flush it from the unmount cleanup below. Holding a
  // whole TtsSettings snapshot here would be wrong: flushing it later would
  // also rewrite voiceName and allowNetworkVoices as they were when the drag
  // began, clobbering fields the drag never touched.
  const pendingRateRef = useRef<number | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  // The cleanup below runs once, after the last render, so it cannot read
  // `draft` directly without capturing the first render's value.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  useEffect(
    () => () => {
      const pendingRate = pendingRateRef.current;
      pendingRateRef.current = null;
      if (pendingRate !== null) {
        onSaveRef.current({ ...draftRef.current, rate: pendingRate });
      }
    },
    [],
  );

  // One effect per field. A single combined effect would reset the whole draft
  // — and drop an in-flight drag — whenever any one field changed externally,
  // losing a rate edit because an unrelated voice write landed.
  useEffect(() => {
    // An external rate write is fresher than an uncommitted drag and is what
    // the slider now shows, so the pending drag goes with it.
    pendingRateRef.current = null;
    setDraft((current) => ({ ...current, rate: settings.rate }));
  }, [settings.rate]);

  useEffect(() => {
    setDraft((current) => ({ ...current, voiceName: settings.voiceName }));
  }, [settings.voiceName]);

  useEffect(() => {
    setDraft((current) => ({
      ...current,
      allowNetworkVoices: settings.allowNetworkVoices,
    }));
  }, [settings.allowNetworkVoices]);

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

  // The range input persists on release (see below), not per drag step, so its
  // onChange only updates local state — recording the value as pending so an
  // unmount before release still flushes it. The voice select and the network
  // checkbox are discrete controls where saving on every change is correct, so
  // they go through `commit` and never leave anything pending.
  function updateRateDraft(rate: number) {
    pendingRateRef.current = rate;
    setDraft((current) => ({ ...current, rate }));
  }

  function commit(next: TtsSettings) {
    setDraft(next);
    onSave(next);
  }

  // Fired by the three release signals below. Bails out when nothing is pending
  // — a bare focus/blur with no drag must not re-save. Composes the pending
  // rate onto the current draft rather than onto `settings`, because a voice
  // committed moments ago may not have round-tripped through storage yet.
  function commitRate() {
    const pendingRate = pendingRateRef.current;
    if (pendingRate === null) return;
    pendingRateRef.current = null;
    onSave({ ...draft, rate: pendingRate });
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
                commit({ ...draft, voiceName: event.target.value || null })
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
                updateRateDraft(Number(event.target.value))
              }
              // Persist on release, not per drag step: dragging fires many
              // onChange events, and saving each one races independent
              // read-modify-write settings updates against each other with
              // no guarantee the last write reflects the last value dragged.
              // All three release signals are needed — pointer for
              // mouse/touch, key for arrow-key adjustment, and blur as a
              // backstop if a pointer release is missed. None of these fire
              // on unmount, though — that path is covered by the pending-ref
              // flush above.
              onPointerUp={commitRate}
              onKeyUp={commitRate}
              onBlur={commitRate}
              className="w-full"
            />
          </div>

          <div>
            <label className="flex items-center gap-2 text-xs text-ink-secondary">
              <input
                type="checkbox"
                checked={draft.allowNetworkVoices}
                onChange={(event) =>
                  commit({ ...draft, allowNetworkVoices: event.target.checked })
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
