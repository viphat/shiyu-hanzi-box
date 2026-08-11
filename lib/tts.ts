import type { Browser } from 'wxt/browser';
import {
  clampTtsRate,
  DEFAULT_TTS_SETTINGS,
  listChineseVoices,
  selectVoice,
  type VoiceCandidate,
} from './tts-voices';
import type { TtsSettings } from './types';

export type TtsState =
  | { status: 'unavailable' }
  | { status: 'idle' }
  | { status: 'speaking'; text: string };

export type TtsListener = (state: TtsState) => void;

let state: TtsState = { status: 'unavailable' };
let settings: TtsSettings = DEFAULT_TTS_SETTINGS;
let webVoices: SpeechSynthesisVoice[] = [];
let chromeVoices: Browser.tts.TtsVoice[] = [];
let candidates: VoiceCandidate[] = [];
let selected: VoiceCandidate | null = null;
let activeUtterance: SpeechSynthesisUtterance | null = null;
let activeChromeSpeech = false;
let activeSpeechToken = 0;
/** Name of the voice powering the in-flight utterance, so revoked eligibility can be detected. */
let speakingVoiceName: string | null = null;
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

/**
 * Merge both engines' voice lists by name. Neither list is a superset:
 * `speechSynthesis` reports which voice is the OS default, and `chrome.tts`
 * reports voices supplied by TTS-engine extensions along with their remoteness.
 */
function collectCandidates(): VoiceCandidate[] {
  const byName = new Map<string, VoiceCandidate>();

  webVoices.forEach((voice, index) => {
    byName.set(voice.name, {
      name: voice.name,
      lang: voice.lang,
      isRemote: !voice.localService,
      isDefault: voice.default === true,
      engines: ['web'],
      index,
    });
  });

  chromeVoices.forEach((voice, index) => {
    const name = voice.voiceName;
    if (!name) return;
    const existing = byName.get(name);
    if (existing) {
      if (!existing.engines.includes('chrome')) existing.engines.push('chrome');
      existing.isRemote = existing.isRemote || voice.remote === true;
      return;
    }
    byName.set(name, {
      name,
      lang: voice.lang ?? '',
      isRemote: voice.remote === true,
      isDefault: false,
      engines: ['chrome'],
      index: webVoices.length + index,
    });
  });

  return [...byName.values()];
}

function resolveSelection(): void {
  candidates = collectCandidates();
  selected = selectVoice(candidates, settings);
}

function findWebVoice(name: string | undefined): SpeechSynthesisVoice | null {
  if (!name) return null;
  return webVoices.find((voice) => voice.name === name) ?? null;
}

function isSpeakingVoiceStillEligible(): boolean {
  if (speakingVoiceName === null) return true;
  return candidates.some(
    (candidate) =>
      candidate.name === speakingVoiceName &&
      (settings.allowNetworkVoices || !candidate.isRemote),
  );
}

function updateAvailableState(): TtsState {
  resolveSelection();

  // Revoking consent for off-device synthesis — or losing the voice entirely —
  // must stop audio already in flight, not merely change what plays next. Being
  // out-ranked by a voice that arrived later is not a reason to interrupt.
  if (state.status === 'speaking' && !isSpeakingVoiceStillEligible()) {
    cancelActiveSpeech();
    setState(selected ? { status: 'idle' } : { status: 'unavailable' });
    return state;
  }

  if (selected) {
    if (state.status === 'speaking') {
      // Don't clobber an in-flight utterance just because the voice list moved.
      notify();
    } else {
      // Emit a fresh object rather than reusing the current one: React
      // subscribers bail out on reference equality, and the voice list can
      // change after the first resolution when chrome.tts resolves late.
      setState({ status: 'idle' });
    }
    return state;
  }

  cancelActiveSpeech();
  setState({ status: 'unavailable' });
  return state;
}

function refreshChromeVoices(): void {
  const chromeTts = getChromeTts();
  if (!chromeTts?.getVoices) {
    chromeVoices = [];
    updateAvailableState();
    return;
  }

  const applyVoices = (voices: Browser.tts.TtsVoice[]) => {
    chromeVoices = voices ?? [];
    updateAvailableState();
  };

  try {
    const maybePromise = chromeTts.getVoices((voices: Browser.tts.TtsVoice[]) =>
      applyVoices(voices),
    );
    if (maybePromise && typeof maybePromise.then === 'function') {
      maybePromise.then(applyVoices).catch(() => {
        chromeVoices = [];
        updateAvailableState();
      });
    }
  } catch {
    chromeVoices = [];
    updateAvailableState();
  }
}

function refreshVoices(): TtsState {
  const synth = getSynth();
  if (!synth) {
    activeUtterance = null;
    webVoices = [];
    return updateAvailableState();
  }

  webVoices = synth.getVoices() ?? [];
  return updateAvailableState();
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
    webVoices = [];
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
  return selected !== null;
}

/** Push the user's saved preferences in. Keeps this module free of storage imports. */
export function configureTts(next: TtsSettings): void {
  settings = { ...next, rate: clampTtsRate(next.rate) };
  updateAvailableState();
}

/** Every Chinese voice for the settings picker, best first. */
export function listVoiceCandidates(): VoiceCandidate[] {
  return listChineseVoices(candidates);
}

/** The voice actually in use, so the UI can flag a saved-but-missing choice. */
export function getSelectedVoiceName(): string | null {
  return selected?.name ?? null;
}

export function subscribeTts(listener: TtsListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Stop whatever is currently speaking, on either engine. Both speak paths and
 * the transition to unavailable need this: the resolved voice can move between
 * engines, so the engine that started an utterance is not necessarily the one
 * about to start the next.
 */
function cancelActiveSpeech(): void {
  speakingVoiceName = null;
  if (activeChromeSpeech) {
    activeSpeechToken += 1;
    activeChromeSpeech = false;
    getChromeTts()?.stop?.();
  }
  if (activeUtterance) {
    activeUtterance = null;
    getSynth()?.cancel();
  }
}

export function speak(text: string): void {
  if (!selected) {
    setState({ status: 'unavailable' });
    return;
  }

  const chromeTts = getChromeTts();
  if (selected.engines.includes('chrome') && chromeTts?.speak) {
    speakWithChromeTts(chromeTts, text);
    return;
  }

  speakWithWebSpeech(text);
}

function speakWithChromeTts(chromeTts: NonNullable<ChromeLike['tts']>, text: string): void {
  if (!chromeTts.speak) return;

  cancelActiveSpeech();

  activeSpeechToken += 1;
  const token = activeSpeechToken;
  activeChromeSpeech = true;
  const lang = selected?.lang || 'zh-CN';
  speakingVoiceName = selected?.name ?? null;

  setState({ status: 'speaking', text });

  try {
    chromeTts.speak(text, {
      lang,
      voiceName: selected?.name,
      enqueue: false,
      volume: 1,
      rate: settings.rate,
      desiredEventTypes: ['start', 'end', 'error', 'interrupted', 'cancelled'],
      onEvent: (event: Browser.tts.TtsEvent) => {
        if (token !== activeSpeechToken) return;
        if (
          event.type === 'end' ||
          event.type === 'error' ||
          event.type === 'interrupted' ||
          event.type === 'cancelled'
        ) {
          activeChromeSpeech = false;
          speakingVoiceName = null;
          setState(selected ? { status: 'idle' } : { status: 'unavailable' });
        }
      },
    });
  } catch {
    activeChromeSpeech = false;
    speakingVoiceName = null;
    speakWithWebSpeech(text);
  }
}

function speakWithWebSpeech(text: string): void {
  const synth = getSynth();
  const voice = findWebVoice(selected?.name);
  if (!synth || !voice || typeof SpeechSynthesisUtterance === 'undefined') {
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return;
  }

  cancelActiveSpeech();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = settings.rate;
  utterance.onend = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    speakingVoiceName = null;
    setState({ status: 'idle' });
  };
  utterance.onerror = () => {
    if (activeUtterance !== utterance) return;
    activeUtterance = null;
    speakingVoiceName = null;
    setState({ status: 'idle' });
  };

  activeUtterance = utterance;
  speakingVoiceName = selected?.name ?? null;
  setState({ status: 'speaking', text });
  synth.speak(utterance);
}

export function stop(): void {
  const chromeTts = getChromeTts();
  if (chromeTts?.stop && activeChromeSpeech) {
    activeSpeechToken += 1;
    activeChromeSpeech = false;
    speakingVoiceName = null;
    chromeTts.stop();
    setState(selected ? { status: 'idle' } : { status: 'unavailable' });
    return;
  }

  const synth = getSynth();
  if (!synth) {
    activeUtterance = null;
    speakingVoiceName = null;
    setState({ status: 'unavailable' });
    return;
  }

  activeUtterance = null;
  speakingVoiceName = null;
  synth.cancel();
  setState(selected ? { status: 'idle' } : { status: 'unavailable' });
}
