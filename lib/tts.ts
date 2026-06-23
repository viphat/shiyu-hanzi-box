import type { Browser } from 'wxt/browser';

export type TtsState =
  | { status: 'unavailable' }
  | { status: 'idle' }
  | { status: 'speaking'; text: string };

export type TtsListener = (state: TtsState) => void;

let state: TtsState = { status: 'unavailable' };
let chromeVoice: Browser.tts.TtsVoice | null = null;
let chineseVoice: SpeechSynthesisVoice | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeChromeSpeech = false;
let activeSpeechToken = 0;
let listenerRegistered = false;
let chromeListenerRegistered = false;

const listeners = new Set<TtsListener>();

type ChromeLike = {
  runtime?: {
    lastError?: {
      message?: string;
    };
  };
  tts?: {
    getVoices?: (
      callback?: (voices: Browser.tts.TtsVoice[]) => void,
    ) => void | Promise<Browser.tts.TtsVoice[]>;
    onVoicesChanged?: {
      addListener?: (listener: () => void) => void;
    };
    speak?: (utterance: string, options?: Browser.tts.TtsOptions) => void | Promise<void>;
    stop?: () => void;
  };
};

function getSynth(): SpeechSynthesis | null {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis
    ? globalThis.speechSynthesis
    : null;
}

function getChromeApi(): ChromeLike | null {
  if (typeof globalThis === 'undefined') return null;
  return (globalThis as typeof globalThis & { chrome?: ChromeLike }).chrome ?? null;
}

function getChromeTts(): ChromeLike['tts'] | null {
  return getChromeApi()?.tts ?? null;
}

function notify(): void {
  for (const listener of listeners) {
    listener(state);
  }
}

function setState(next: TtsState): void {
  state = next;
  notify();
}

function pickChineseVoice(voices: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const zhCN = voices.find((voice) => voice.lang === 'zh-CN');
  if (zhCN) return zhCN;
  return voices.find((voice) => voice.lang.startsWith('zh')) ?? null;
}

function pickChromeChineseVoice(voices: Browser.tts.TtsVoice[]): Browser.tts.TtsVoice | null {
  const zhCN = voices.find((voice) => voice.lang === 'zh-CN');
  if (zhCN) return zhCN;
  return voices.find((voice) => voice.lang?.startsWith('zh')) ?? null;
}

function updateAvailableState(): TtsState {
  if (chromeVoice || chineseVoice) {
    if (state.status === 'unavailable') {
      setState({ status: 'idle' });
    } else {
      notify();
    }
    return state;
  }

  activeUtterance = null;
  activeChromeSpeech = false;
  setState({ status: 'unavailable' });
  return state;
}

function refreshChromeVoices(): void {
  const chromeTts = getChromeTts();
  if (!chromeTts?.getVoices) {
    chromeVoice = null;
    updateAvailableState();
    return;
  }

  const applyVoices = (voices: Browser.tts.TtsVoice[]) => {
    chromeVoice = pickChromeChineseVoice(voices);
    updateAvailableState();
  };

  try {
    const maybePromise = chromeTts.getVoices((voices: Browser.tts.TtsVoice[]) => applyVoices(voices));
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(applyVoices).catch(() => {
        chromeVoice = null;
        updateAvailableState();
      });
    }
  } catch {
    chromeVoice = null;
    updateAvailableState();
  }
}

function refreshVoices(): TtsState {
  const synth = getSynth();
  if (!synth) {
    activeUtterance = null;
    chineseVoice = null;
    return updateAvailableState();
  }

  chineseVoice = pickChineseVoice(synth.getVoices());
  if (!chineseVoice) {
    activeUtterance = null;
    return updateAvailableState();
  }

  updateAvailableState();
  return state;
}

export function initTts(): TtsState {
  const chromeTts = getChromeTts();
  if (chromeTts?.onVoicesChanged?.addListener && !chromeListenerRegistered) {
    chromeListenerRegistered = true;
    chromeTts.onVoicesChanged.addListener(refreshChromeVoices);
  }
  refreshChromeVoices();

  const synth = getSynth();
  if (!synth) {
    activeUtterance = null;
    chineseVoice = null;
    return updateAvailableState();
  }

  if (!listenerRegistered) {
    listenerRegistered = true;
    synth.addEventListener('voiceschanged', refreshVoices);
  }

  return refreshVoices();
}

export function getTtsState(): TtsState {
  return state;
}

export function isChineseVoiceAvailable(): boolean {
  return chromeVoice !== null || chineseVoice !== null;
}

export function subscribeTts(listener: TtsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function speak(text: string): void {
  const chromeTts = getChromeTts();
  if (chromeTts?.speak && (chromeVoice || chineseVoice)) {
    speakWithChromeTts(chromeTts, text);
    return;
  }

  speakWithWebSpeech(text);
}

function speakWithChromeTts(chromeTts: NonNullable<ChromeLike['tts']>, text: string): void {
  if (!chromeTts.speak) return;

  if (activeChromeSpeech) {
    chromeTts.stop?.();
  } else if (activeUtterance) {
    activeUtterance = null;
    getSynth()?.cancel();
  }

  activeSpeechToken += 1;
  const token = activeSpeechToken;
  activeChromeSpeech = true;
  const lang = chromeVoice?.lang ?? chineseVoice?.lang ?? 'zh-CN';

  setState({ status: 'speaking', text });

  try {
    chromeTts.speak(text, {
      lang,
      voiceName: chromeVoice?.voiceName,
      enqueue: false,
      volume: 1,
      rate: 1,
      desiredEventTypes: ['start', 'end', 'error', 'interrupted', 'cancelled'],
      onEvent: (event: Browser.tts.TtsEvent) => {
        if (token !== activeSpeechToken) return;
        if (event.type === 'end' || event.type === 'error' || event.type === 'interrupted' || event.type === 'cancelled') {
          activeChromeSpeech = false;
          setState(chromeVoice || chineseVoice ? { status: 'idle' } : { status: 'unavailable' });
        }
      },
    });
  } catch {
    activeChromeSpeech = false;
    speakWithWebSpeech(text);
  }
}

function speakWithWebSpeech(text: string): void {
  const synth = getSynth();
  if (!synth || !chineseVoice || typeof SpeechSynthesisUtterance === 'undefined') {
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return;
  }

  if (activeUtterance) {
    activeUtterance = null;
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = chineseVoice;
  utterance.lang = chineseVoice.lang;
  utterance.onend = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    setState({ status: 'idle' });
  };
  utterance.onerror = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    setState({ status: 'idle' });
  };

  activeUtterance = utterance;
  setState({ status: 'speaking', text });
  synth.speak(utterance);
}

export function stop(): void {
  const chromeTts = getChromeTts();
  if (chromeTts?.stop && activeChromeSpeech) {
    activeSpeechToken += 1;
    activeChromeSpeech = false;
    chromeTts.stop();
    setState(chromeVoice || chineseVoice ? { status: 'idle' } : { status: 'unavailable' });
    return;
  }

  const synth = getSynth();
  if (!synth) {
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return;
  }

  activeUtterance = null;
  synth.cancel();
  setState(chineseVoice ? { status: 'idle' } : { status: 'unavailable' });
}
