import { AlertCircle, Volume2 } from 'lucide-react';
import { useEffect, useState, type MouseEvent } from 'react';
import { t } from '@/lib/i18n';
import {
  getTtsState,
  initTts,
  isChineseVoiceAvailable,
  speak,
  stop,
  subscribeTts,
  type TtsState,
} from '@/lib/tts';
import type { UiLocale } from '@/lib/types';

export function SpeakButton({ text, locale }: { text: string; locale: UiLocale }) {
  const [ttsState, setTtsState] = useState<TtsState>(getTtsState);

  useEffect(() => {
    const unsubscribe = subscribeTts(setTtsState);
    setTtsState(initTts());
    return unsubscribe;
  }, []);

  if (!isChineseVoiceAvailable()) return null;

  const isSpeakingThisText = ttsState.status === 'speaking' && ttsState.text === text;
  // Keyed to the text, so one word failing does not put an alert icon on
  // every other SpeakButton on the page. Clicking still retries — the failure
  // is usually transient (a busy audio device, an engine that dropped out),
  // and the state clears itself on the next attempt.
  const hasFailed = ttsState.status === 'error' && ttsState.text === text;
  const label = t(locale, hasFailed ? 'tts.speakFailed' : 'tts.speak');

  const handleClick = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    if (isSpeakingThisText) {
      stop();
    } else {
      speak(text);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={label}
      aria-label={label}
      aria-pressed={isSpeakingThisText}
      className={`rounded-sm p-1 transition ${
        isSpeakingThisText
          ? 'animate-pulse text-accent-deep'
          : hasFailed
            ? 'text-accent-deep hover:bg-paper-input'
            : 'text-muted hover:bg-paper-input hover:text-accent-deep'
      }`}
    >
      {hasFailed ? (
        <AlertCircle className="h-3.5 w-3.5" />
      ) : (
        <Volume2 className="h-3.5 w-3.5" />
      )}
    </button>
  );
}
