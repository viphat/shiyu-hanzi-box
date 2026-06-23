export type TtsState =
  | { status: 'unavailable' }
  | { status: 'idle' }
  | { status: 'speaking'; text: string };

export type TtsListener = (state: TtsState) => void;

let state: TtsState = { status: 'unavailable' };
let chineseVoice: SpeechSynthesisVoice | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let listenerRegistered = false;
let warmedUp = false;

const listeners = new Set<TtsListener>();

function getSynth(): SpeechSynthesis | null {
  return typeof globalThis !== 'undefined' && 'speechSynthesis' in globalThis
    ? globalThis.speechSynthesis
    : null;
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

function warmUp(synth: SpeechSynthesis): void {
  if (warmedUp || !chineseVoice || typeof SpeechSynthesisUtterance === 'undefined') return;

  warmedUp = true;
  const warmup = new SpeechSynthesisUtterance('一');
  warmup.voice = chineseVoice;
  warmup.lang = chineseVoice.lang;
  warmup.volume = 0;
  warmup.rate = 10;
  synth.speak(warmup);
  synth.cancel();
}

function refreshVoices(): TtsState {
  const synth = getSynth();
  if (!synth) {
    chineseVoice = null;
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return state;
  }

  chineseVoice = pickChineseVoice(synth.getVoices());
  if (!chineseVoice) {
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return state;
  }

  if (state.status === 'unavailable') {
    setState({ status: 'idle' });
  } else {
    notify();
  }
  warmUp(synth);
  return state;
}

export function initTts(): TtsState {
  const synth = getSynth();
  if (!synth) {
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return state;
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
  return chineseVoice !== null;
}

export function subscribeTts(listener: TtsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function speak(text: string): void {
  const synth = getSynth();
  if (!synth || !chineseVoice || typeof SpeechSynthesisUtterance === 'undefined') {
    if (!synth || !chineseVoice) {
      activeUtterance = null;
      setState({ status: 'unavailable' });
    }
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
