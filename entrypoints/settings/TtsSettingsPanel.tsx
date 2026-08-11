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
  // activeElement` silently moves to `<body>` instead. Track whatever the
  // drag has left uncommitted and flush it from the unmount cleanup below,
  // rather than silently dropping the change.
  const pendingRef = useRef<TtsSettings | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  useEffect(
    () => () => {
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) onSaveRef.current(pending);
    },
    [],
  );

  useEffect(() => {
    // An external write is fresher than an uncommitted drag and is already
    // what the slider shows, so drop the pending value rather than flushing
    // it over the newer one at unmount.
    pendingRef.current = null;
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

  // The range input persists on release (see below), not per drag step, so
  // its onChange only updates local state — but records the value as
  // "pending" so an unmount before release still flushes it. The voice
  // select and the network checkbox are discrete controls where saving on
  // every change is correct, so they go through `commit` and never leave
  // anything pending.
  function updateDraft(next: TtsSettings) {
    pendingRef.current = next;
    setDraft(next);
  }

  function commit(next: TtsSettings) {
    pendingRef.current = null;
    setDraft(next);
    onSave(next);
  }

  // Fired by the three release signals below. Reads pendingRef rather than
  // draft so this and the unmount flush always agree on what "uncommitted"
  // means, and bails out entirely when nothing is pending — a bare
  // focus/blur with no drag must not re-save the current draft.
  function commitRate() {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    onSave(pending);
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
                updateDraft({ ...draft, rate: Number(event.target.value) })
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
