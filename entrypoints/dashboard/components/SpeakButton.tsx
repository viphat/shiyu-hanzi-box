import { Volume2 } from 'lucide-react';
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
      title={t(locale, 'tts.speak')}
      aria-label={t(locale, 'tts.speak')}
      aria-pressed={isSpeakingThisText}
      className={`rounded-sm p-1 transition ${
        isSpeakingThisText
          ? 'animate-pulse text-cinnabar'
          : 'text-muted hover:bg-paper-input hover:text-cinnabar'
      }`}
    >
      <Volume2 className="h-3.5 w-3.5" />
    </button>
  );
}
