import type { Browser } from 'wxt/browser';
import {
  clampTtsRate,
  DEFAULT_TTS_SETTINGS,
  listChineseVoices,
  selectVoice,
  voiceMergeKey,
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
 * Merge both engines' voice lists by physical voice. Neither list is a
 * superset: `speechSynthesis` reports which voice is the OS default, and
 * `chrome.tts` reports voices supplied by TTS-engine extensions along with
 * their remoteness.
 *
 * Web voices are never collapsed into each other — `name` is their identity.
 * `voiceMergeKey` only ever pairs a *chrome* voice onto a web one, and only
 * as a hint: exact name match wins first (chrome sometimes reports the
 * identical string), and the stripped-suffix key is consulted only when no
 * exact match exists, and only pairs when it identifies exactly one web
 * voice. Quality/gender variants of a voice family — `Foo (Male)` /
 * `Foo (Female)` — collide on that stripped key despite being distinct
 * voices, so an ambiguous key must NOT pair; the chrome voice becomes its
 * own candidate instead. Guessing wrong here is worse than not merging: it
 * can point the picker's label at one physical voice while `chrome.tts.speak`
 * is told to speak another (see `VoiceCandidate.engineNames`).
 *
 * The chrome list is merged even when `chrome.tts.speak` is missing — it is
 * what supplies `remote` for the network gate, which matters regardless of
 * which engine ends up doing the speaking. Only *chrome-only* candidates are
 * dropped in that case; see `canChromeSpeak` below.
 */
function collectCandidates(): VoiceCandidate[] {
  const webByName = new Map<string, VoiceCandidate>();
  const webByKey = new Map<string, VoiceCandidate[]>();

  webVoices.forEach((voice, index) => {
    const candidate: VoiceCandidate = {
      name: voice.name,
      lang: voice.lang,
      // Fail CLOSED: an undefined `localService` counts as remote and is
      // gated off. The Web Speech spec makes the field required, so a missing
      // value is anomalous rather than routine, and treating it as local
      // would let a network voice speak without the user's consent. Note the
      // deliberate asymmetry with the chrome branch below.
      isRemote: !voice.localService,
      isDefault: voice.default === true,
      engines: ['web'],
      engineNames: { web: voice.name },
      index,
    };
    webByName.set(voice.name, candidate);
    const key = voiceMergeKey(voice.name, voice.lang);
    const bucket = webByKey.get(key);
    if (bucket) bucket.push(candidate);
    else webByKey.set(key, [candidate]);
  });

  const chromeOnlyCandidates: VoiceCandidate[] = [];
  // A chrome-only candidate has no Web Speech spelling, so `speakWithWebSpeech`
  // cannot pronounce it. Without `chrome.tts.speak` nothing can, and offering
  // it would put a voice in the picker — and a button on the dashboard — that
  // silently does nothing when used.
  const canChromeSpeak = typeof getChromeTts()?.speak === 'function';

  chromeVoices.forEach((voice, index) => {
    const name = voice.voiceName;
    if (!name) return;
    const lang = voice.lang ?? '';

    // Exact name match is definitive identity, not a hint — try it first.
    let target = webByName.get(name);

    if (!target) {
      const bucket = webByKey.get(voiceMergeKey(name, lang));
      // Pair on the stripped-suffix hint only when it is unambiguous.
      if (bucket && bucket.length === 1) target = bucket[0];
    }

    // Never overwrite an already-paired web candidate's chrome spelling: a
    // second chrome voice landing on the same target stays standalone
    // rather than silently reassigning what chrome.tts is told to speak.
    if (target && !target.engineNames.chrome) {
      if (!target.engines.includes('chrome')) target.engines.push('chrome');
      // OR, never AND: either engine calling the voice remote is enough to
      // gate it. The merge is what lets a voice Web Speech reports as local
      // still be caught by chrome's verdict on the same physical voice.
      target.isRemote = target.isRemote || voice.remote === true;
      target.engineNames.chrome = name;
      return;
    }

    if (!canChromeSpeak) return;

    chromeOnlyCandidates.push({
      name,
      lang,
      // Fail OPEN, unlike the web branch above: `remote` is optional on
      // `chrome.tts.TtsVoice`, so an undefined value is routine rather than
      // anomalous. Failing closed here would gate off genuinely local voices
      // on any platform that omits the field, and for a chrome-only voice
      // there is no web-side entry to fall back to — the user would be left
      // with no pronunciation at all. The gap is bounded: a voice that is
      // really remote and omits the field still has to be an extension's
      // chrome-only voice to slip through, since anything both engines know
      // about is caught by the OR-merge above.
      isRemote: voice.remote === true,
      isDefault: false,
      engines: ['chrome'],
      engineNames: { chrome: name },
      index: webVoices.length + index,
    });
  });

  return [...webByName.values(), ...chromeOnlyCandidates];
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
      voiceName: selected?.engineNames.chrome,
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
  const voice = findWebVoice(selected?.engineNames.web);
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
