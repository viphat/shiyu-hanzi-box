import type { TtsSettings } from './types';

/**
 * A voice from either speech engine, normalized to one shape so both can be
 * ranked on the same scale. Chrome exposes two voice lists and neither is a
 * superset: `speechSynthesis` knows which voice is the OS default, and
 * `chrome.tts` knows about voices supplied by TTS-engine extensions.
 */
export type VoiceCandidate = {
  /**
   * Display identity: what the picker shows and what `TtsSettings.voiceName`
   * stores. The Web Speech spelling when present (its language suffix is
   * genuinely more informative to the user), otherwise the chrome spelling.
   * NOT necessarily what either engine accepts back — see `engineNames`.
   */
  name: string;
  lang: string;
  /** Synthesized off-device — Web Speech `!localService`, or chrome's `remote`. */
  isRemote: boolean;
  /** The OS System Voice. Web Speech only; chrome-only voices are never default. */
  isDefault: boolean;
  engines: Array<'chrome' | 'web'>;
  /**
   * The name each engine actually accepts for this physical voice. The two
   * engines spell the same voice differently when Web Speech disambiguates a
   * name that exists in more than one locale by appending the language —
   * `speak()` must pass each engine its own spelling, not the merged `name`.
   */
  engineNames: { web?: string; chrome?: string };
  /** Position in the source list, so equal scores break deterministically. */
  index: number;
};

export const MIN_TTS_RATE = 0.5;
export const MAX_TTS_RATE = 1.5;

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  voiceName: null,
  rate: 1,
  allowNetworkVoices: false,
};

/**
 * Apple's Eloquence voices: a formant synthesizer bundled for accessibility.
 * Intelligible but robotic, and macOS reports them ahead of Tingting, so the
 * previous `find(lang === 'zh-CN')` selection landed on one of these. They stay
 * in the picker — a user may deliberately want one — but are never chosen
 * automatically.
 */
export const ELOQUENCE_VOICE_NAMES = [
  'Eddy',
  'Flo',
  'Grandma',
  'Grandpa',
  'Reed',
  'Rocko',
  'Sandy',
  'Shelley',
] as const;

/**
 * Voices known to be real speech engines rather than novelty or fallback ones.
 * A hint, not a whitelist: unknown voices still rank on their other signals.
 */
const KNOWN_GOOD_VOICE_NAMES = [
  'Tingting',
  'Ting-Ting',
  '婷婷',
  'Huihui',
  'Yaoyao',
  'Xiaoxiao',
  'Yunxi',
  'Yunyang',
  'Google 普通话',
];

/**
 * Web Speech renders these as `Eddy (Chinese (China mainland))` while
 * `chrome.tts` renders them as `Eddy`, so match the token before `' ('`.
 */
export function isEloquenceVoice(name: string): boolean {
  const leading = name.split(' (')[0].trim();
  return ELOQUENCE_VOICE_NAMES.some((eloquence) => eloquence === leading);
}

/**
 * A pairing HINT for matching a chrome.tts voice onto a Web Speech one — NOT
 * an identity, and not safe to use as one. Web Speech disambiguates a name
 * that exists in more than one locale by appending the language — `Eddy
 * (Chinese (China mainland))` — where chrome.tts reports the bare `Eddy`.
 * Keying on the leading token alone would collapse the zh-CN and zh-TW
 * variants of one name into a single candidate, so the language is part of
 * the key.
 *
 * This is still lossy: quality/gender variants of one voice family —
 * `Foo (Male)` / `Foo (Female)` — strip down to the same key despite being
 * distinct voices. Two real, distinct web voices can share a key. Callers
 * must therefore only pair on this key when it is unambiguous (exactly one
 * candidate has it) and must never use it to collapse two web voices into
 * each other — `name` is the identity there. See `collectCandidates` in
 * `lib/tts.ts` for how the ambiguous case is handled.
 */
export function voiceMergeKey(name: string, lang: string): string {
  return `${name.split(' (')[0].trim()} ${lang.toLowerCase()}`;
}

export function isChineseVoice(lang: string): boolean {
  return lang.toLowerCase().startsWith('zh');
}

export function clampTtsRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_TTS_SETTINGS.rate;
  return Math.min(MAX_TTS_RATE, Math.max(MIN_TTS_RATE, rate));
}

export function scoreVoice(candidate: VoiceCandidate): number {
  let score = 0;
  const lower = candidate.name.toLowerCase();
  if (lower.includes('premium')) score += 40;
  if (lower.includes('enhanced') || lower.includes('neural')) score += 30;
  if (KNOWN_GOOD_VOICE_NAMES.some((known) => candidate.name.includes(known))) score += 20;
  // Only reachable when the user has opted into network voices; rankVoices
  // filters remote voices out otherwise.
  if (candidate.isRemote) score += 25;
  if (candidate.lang.toLowerCase() === 'zh-cn') score += 10;
  return score;
}

/**
 * The OS System Voice wins by construction rather than by out-scoring the
 * heuristics: name-based bonuses can stack past any fixed bonus, so tier on
 * isDefault first and only then fall back to score and source order.
 */
function compareVoices(a: VoiceCandidate, b: VoiceCandidate): number {
  if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
  return scoreVoice(b) - scoreVoice(a) || a.index - b.index;
}

/** Chinese voices eligible for automatic selection, best first. */
export function rankVoices(
  candidates: VoiceCandidate[],
  allowNetworkVoices: boolean,
): VoiceCandidate[] {
  return candidates
    .filter((candidate) => isChineseVoice(candidate.lang))
    .filter((candidate) => !isEloquenceVoice(candidate.name))
    .filter((candidate) => allowNetworkVoices || !candidate.isRemote)
    .slice()
    .sort(compareVoices);
}

/** Every Chinese voice for the picker, best first — including ones never auto-selected. */
export function listChineseVoices(candidates: VoiceCandidate[]): VoiceCandidate[] {
  return candidates
    .filter((candidate) => isChineseVoice(candidate.lang))
    .slice()
    .sort(compareVoices);
}

export function selectVoice(
  candidates: VoiceCandidate[],
  settings: TtsSettings,
): VoiceCandidate | null {
  if (settings.voiceName) {
    // An explicit choice wins, including an Eloquence voice, but the network
    // gate still applies: turning the toggle off must stop remote synthesis
    // even if a remote voice is still saved.
    const chosen = candidates.find(
      (candidate) =>
        candidate.name === settings.voiceName &&
        (settings.allowNetworkVoices || !candidate.isRemote),
    );
    if (chosen) return chosen;
  }
  return rankVoices(candidates, settings.allowNetworkVoices)[0] ?? null;
}
