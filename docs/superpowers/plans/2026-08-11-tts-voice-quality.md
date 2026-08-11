# TTS Voice Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the extension reading Chinese words in a novelty voice, and let the user choose the voice and speed themselves.

**Architecture:** A new pure module `lib/tts-voices.ts` normalizes voices from both speech engines into one `VoiceCandidate` shape and ranks them; `lib/tts.ts` keeps all DOM and engine state and consumes that ranking; a new `TtsSettingsPanel` writes the user's choice into `AppSettings.tts`, which the dashboard pushes into `lib/tts.ts` via `configureTts()`. `lib/tts.ts` never imports storage, so it stays unit-testable with only `speechSynthesis` mocked.

**Tech Stack:** TypeScript, React 19, WXT (MV3 extension), Vitest, Tailwind 4.

## Global Constraints

- `lib/tts.ts` must not import from `lib/settings.ts` or any storage module. Shared constants live in `lib/tts-voices.ts`, which both import.
- Rate is clamped to `[0.5, 1.5]`; the default is `1` (today's behaviour).
- `allowNetworkVoices` defaults to `false`.
- Every new user-facing string needs a key in **both** `en` and `zh-CN` in `lib/i18n.ts`.
- Never auto-select an Eloquence voice: `Eddy`, `Flo`, `Grandma`, `Grandpa`, `Reed`, `Rocko`, `Sandy`, `Shelley`.
- Follow the repo's conventional-commit style (`feat:`, `fix:`, `docs:`, `test:`).
- Do not reference source lines by number in docs or comments; reference symbols by name.

## Scope Deviation From The Spec

The spec's **Warm-up** section is deliberately **not implemented**. See
[Task 7](#task-7-decision-record-for-the-dropped-warm-up) — it is a documentation
task, not an implementation one. Rationale is recorded there so the decision is
not silently lost.

---

### Task 1: Pure voice ranking module

**Files:**
- Create: `lib/tts-voices.ts`
- Test: `tests/tts-voices.test.ts`

**Interfaces:**
- Consumes: nothing (leaf module).
- Produces:
  - `type VoiceCandidate = { name: string; lang: string; isRemote: boolean; isDefault: boolean; engines: Array<'chrome' | 'web'>; index: number }`
  - `const DEFAULT_TTS_SETTINGS: TtsSettings`
  - `const MIN_TTS_RATE = 0.5`, `const MAX_TTS_RATE = 1.5`
  - `function clampTtsRate(rate: number): number`
  - `function isEloquenceVoice(name: string): boolean`
  - `function isChineseVoice(lang: string): boolean`
  - `function scoreVoice(candidate: VoiceCandidate): number`
  - `function rankVoices(candidates: VoiceCandidate[], allowNetworkVoices: boolean): VoiceCandidate[]`
  - `function selectVoice(candidates: VoiceCandidate[], settings: TtsSettings): VoiceCandidate | null`
  - `function listChineseVoices(candidates: VoiceCandidate[]): VoiceCandidate[]`

> Step 1 adds the `TtsSettings` type. It lives in `lib/types.ts` rather than in this new module because every other settings interface lives there; Task 2 wires it into `AppSettings`.

- [ ] **Step 1: Add the `TtsSettings` type to `lib/types.ts`**

Insert after the `SrsSettings` interface:

```ts
export interface TtsSettings {
  /** Voice name to use, or null to auto-select the best available. */
  voiceName: string | null;
  /** Playback rate, clamped to [MIN_TTS_RATE, MAX_TTS_RATE]. */
  rate: number;
  /** Allow voices synthesized off-device. Off by default: they send text to the provider. */
  allowNetworkVoices: boolean;
}
```

- [ ] **Step 2: Write the failing tests**

Create `tests/tts-voices.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTS_SETTINGS,
  clampTtsRate,
  isEloquenceVoice,
  listChineseVoices,
  rankVoices,
  selectVoice,
  type VoiceCandidate,
} from '../lib/tts-voices';

function candidate(overrides: Partial<VoiceCandidate> & { name: string }): VoiceCandidate {
  return {
    lang: 'zh-CN',
    isRemote: false,
    isDefault: false,
    engines: ['web'],
    index: 0,
    ...overrides,
  };
}

describe('isEloquenceVoice', () => {
  it('matches the bare chrome.tts spelling', () => {
    expect(isEloquenceVoice('Eddy')).toBe(true);
  });

  it('matches the Web Speech spelling with the language suffix', () => {
    expect(isEloquenceVoice('Eddy (Chinese (China mainland))')).toBe(true);
    expect(isEloquenceVoice('Grandma (Chinese (Taiwan))')).toBe(true);
  });

  it('does not match real voices', () => {
    expect(isEloquenceVoice('Tingting')).toBe(false);
    expect(isEloquenceVoice('Meijia')).toBe(false);
  });
});

describe('rankVoices', () => {
  it('ranks Tingting above Eddy — the reported defect', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Tingting', index: 17 }),
    ];

    const ranked = rankVoices(voices, false);

    expect(ranked[0].name).toBe('Tingting');
  });

  it('excludes every Eloquence voice from auto-selection', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Shelley', index: 1 }),
    ];

    expect(rankVoices(voices, false)).toEqual([]);
  });

  it('drops non-Chinese voices', () => {
    const voices = [
      candidate({ name: 'Samantha', lang: 'en-US', index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    const ranked = rankVoices(voices, false);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe('Tingting');
  });

  it('lets the OS default voice beat a higher-scoring non-default voice', () => {
    const voices = [
      candidate({ name: 'Tingting', index: 0 }),
      candidate({ name: 'Meijia', lang: 'zh-TW', isDefault: true, index: 1 }),
    ];

    expect(rankVoices(voices, false)[0].name).toBe('Meijia');
  });

  it('keeps the OS default ahead of a voice stacking every other bonus', () => {
    const voices = [
      candidate({
        name: 'Xiaoxiao Premium Neural',
        lang: 'zh-CN',
        isRemote: true,
        index: 0,
      }),
      candidate({ name: 'Meijia', lang: 'zh-TW', isDefault: true, index: 1 }),
    ];

    expect(rankVoices(voices, true)[0].name).toBe('Meijia');
  });

  it('scores the zh-CN bonus regardless of tag casing', () => {
    const voices = [
      candidate({ name: 'Lowercase Tag', lang: 'zh-cn', index: 0 }),
      candidate({ name: 'Other Region', lang: 'zh-TW', index: 1 }),
    ];

    expect(rankVoices(voices, false)[0].name).toBe('Lowercase Tag');
  });

  it('never auto-selects an Eloquence voice even when it is the OS default', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', isDefault: true, index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    expect(rankVoices(voices, false)[0].name).toBe('Tingting');
  });

  it('excludes remote voices unless network voices are allowed', () => {
    const voices = [candidate({ name: 'Google 普通话', isRemote: true, index: 0 })];

    expect(rankVoices(voices, false)).toEqual([]);
    expect(rankVoices(voices, true)[0].name).toBe('Google 普通话');
  });

  it('breaks equal scores toward the lower source index', () => {
    const voices = [
      candidate({ name: 'Voice B', index: 5 }),
      candidate({ name: 'Voice A', index: 2 }),
    ];

    expect(rankVoices(voices, false).map((v) => v.name)).toEqual(['Voice A', 'Voice B']);
  });
});

describe('selectVoice', () => {
  it('honours an explicit voice name over the ranking', () => {
    const voices = [
      candidate({ name: 'Tingting', index: 0 }),
      candidate({ name: 'Meijia', lang: 'zh-TW', index: 1 }),
    ];

    const chosen = selectVoice(voices, { ...DEFAULT_TTS_SETTINGS, voiceName: 'Meijia' });

    expect(chosen?.name).toBe('Meijia');
  });

  it('honours an explicitly chosen Eloquence voice', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    const chosen = selectVoice(voices, {
      ...DEFAULT_TTS_SETTINGS,
      voiceName: 'Eddy (Chinese (China mainland))',
    });

    expect(chosen?.name).toBe('Eddy (Chinese (China mainland))');
  });

  it('ignores an explicit remote voice when network voices are off', () => {
    const voices = [
      candidate({ name: 'Google 普通话', isRemote: true, index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    const chosen = selectVoice(voices, {
      ...DEFAULT_TTS_SETTINGS,
      voiceName: 'Google 普通话',
    });

    expect(chosen?.name).toBe('Tingting');
  });

  it('falls back to the ranking when the saved voice is gone', () => {
    const voices = [candidate({ name: 'Tingting', index: 0 })];

    const chosen = selectVoice(voices, { ...DEFAULT_TTS_SETTINGS, voiceName: 'Removed Voice' });

    expect(chosen?.name).toBe('Tingting');
  });

  it('returns null when nothing is eligible', () => {
    expect(selectVoice([], DEFAULT_TTS_SETTINGS)).toBeNull();
  });
});

describe('listChineseVoices', () => {
  it('keeps Eloquence and remote voices for the picker but sinks them', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
      candidate({ name: 'Samantha', lang: 'en-US', index: 2 }),
    ];

    const listed = listChineseVoices(voices);

    expect(listed.map((v) => v.name)).toEqual([
      'Tingting',
      'Eddy (Chinese (China mainland))',
    ]);
  });
});

describe('clampTtsRate', () => {
  it('clamps below the floor and above the ceiling', () => {
    expect(clampTtsRate(0.1)).toBe(0.5);
    expect(clampTtsRate(9)).toBe(1.5);
  });

  it('passes valid rates through and falls back for non-numbers', () => {
    expect(clampTtsRate(1.2)).toBe(1.2);
    expect(clampTtsRate(Number.NaN)).toBe(1);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/tts-voices.test.ts`
Expected: FAIL — `Failed to resolve import "../lib/tts-voices"`.

- [ ] **Step 4: Write the implementation**

Create `lib/tts-voices.ts`:

```ts
import type { TtsSettings } from './types';

/**
 * A voice from either speech engine, normalized to one shape so both can be
 * ranked on the same scale. Chrome exposes two voice lists and neither is a
 * superset: `speechSynthesis` knows which voice is the OS default, and
 * `chrome.tts` knows about voices supplied by TTS-engine extensions.
 */
export type VoiceCandidate = {
  /** Display name as the engine reports it. Also the merge key across engines. */
  name: string;
  lang: string;
  /** Synthesized off-device — Web Speech `!localService`, or chrome's `remote`. */
  isRemote: boolean;
  /** The OS System Voice. Web Speech only; chrome-only voices are never default. */
  isDefault: boolean;
  engines: Array<'chrome' | 'web'>;
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
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/tts-voices.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Type-check and commit**

```bash
npm run compile
git add lib/tts-voices.ts lib/types.ts tests/tts-voices.test.ts
git commit -m "feat(tts): add voice ranking that never picks a novelty voice"
```

---

### Task 2: Settings plumbing

**Files:**
- Modify: `lib/settings.ts`
- Test: `tests/settings.test.ts`

**Interfaces:**
- Consumes: `DEFAULT_TTS_SETTINGS`, `clampTtsRate` from `lib/tts-voices.ts`; `TtsSettings` from `lib/types.ts`.
- Produces: `AppSettings.tts: TtsSettings`, and `setTtsSettings(settings: AppSettings, tts: TtsSettings): AppSettings`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/settings.test.ts`, inside the existing `describe('settings helpers', ...)` block:

```ts
  it('defaults TTS to auto voice, normal rate, and local voices only', () => {
    expect(DEFAULT_SETTINGS.tts).toEqual({
      voiceName: null,
      rate: 1,
      allowNetworkVoices: false,
    });
  });

  it('applies TTS defaults when stored settings predate the field', () => {
    const normalized = normalizeSettings({ uiLocale: 'en' });

    expect(normalized.tts).toEqual({
      voiceName: null,
      rate: 1,
      allowNetworkVoices: false,
    });
  });

  it('clamps a stored rate at both bounds', () => {
    expect(normalizeSettings({ tts: { rate: 0.1 } }).tts.rate).toBe(0.5);
    expect(normalizeSettings({ tts: { rate: 9 } }).tts.rate).toBe(1.5);
    expect(normalizeSettings({ tts: { rate: 1.2 } }).tts.rate).toBe(1.2);
  });

  it('coerces a blank stored voice name to auto', () => {
    expect(normalizeSettings({ tts: { voiceName: '' } }).tts.voiceName).toBeNull();
  });

  it('updates TTS settings immutably', () => {
    const next = setTtsSettings(DEFAULT_SETTINGS, {
      voiceName: 'Tingting',
      rate: 0.8,
      allowNetworkVoices: true,
    });

    expect(next.tts).toEqual({
      voiceName: 'Tingting',
      rate: 0.8,
      allowNetworkVoices: true,
    });
    expect(next.uiLocale).toBe(DEFAULT_SETTINGS.uiLocale);
    expect(next.srs).toEqual(DEFAULT_SETTINGS.srs);
    expect(DEFAULT_SETTINGS.tts.voiceName).toBeNull();
  });
```

Add `setTtsSettings` to the existing import list from `../lib/settings` at the top of the file.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/settings.test.ts`
Expected: FAIL — `setTtsSettings is not a function` and `DEFAULT_SETTINGS.tts` is `undefined`.

- [ ] **Step 3: Add the default and the type import**

In `lib/settings.ts`, add to the existing import from `./types`: `TtsSettings`. Add a new import below it:

```ts
import { DEFAULT_TTS_SETTINGS, clampTtsRate } from './tts-voices';
```

Re-export the default so consumers have one import site:

```ts
export { DEFAULT_TTS_SETTINGS } from './tts-voices';
```

- [ ] **Step 4: Add `tts` to `DEFAULT_SETTINGS`**

```ts
export const DEFAULT_SETTINGS: AppSettings = {
  uiLocale: 'zh-CN',
  reviewMode: 'srs',
  kaikki: DEFAULT_KAIKKI_SETTINGS,
  cvdict: DEFAULT_CVDICT_SETTINGS,
  srs: DEFAULT_SRS_SETTINGS,
  tts: DEFAULT_TTS_SETTINGS,
};
```

- [ ] **Step 5: Add `tts` to `AppSettings` in `lib/types.ts`**

```ts
export interface AppSettings {
  uiLocale: UiLocale;
  reviewMode: ReviewMode;
  kaikki: KaikkiSettings;
  cvdict: CvdictSettings;
  srs: SrsSettings;
  tts: TtsSettings;
}
```

- [ ] **Step 6: Normalize stored values**

In `lib/settings.ts`, extend `StoredAppSettings` — add `'tts'` to the `Omit` list and a partial field:

```ts
type StoredAppSettings = Partial<Omit<AppSettings, 'kaikki' | 'cvdict' | 'srs' | 'tts'>> & {
  kaikki?: Partial<KaikkiSettings>;
  cvdict?: Partial<CvdictSettings>;
  srs?: Partial<SrsSettings>;
  tts?: Partial<TtsSettings>;
};
```

Add the `tts` line to `normalizeSettings`:

```ts
export function normalizeSettings(
  value: StoredAppSettings | undefined | null,
): AppSettings {
  return {
    uiLocale: value?.uiLocale ?? DEFAULT_SETTINGS.uiLocale,
    reviewMode: value?.reviewMode === 'drift' ? 'drift' : 'srs',
    kaikki: { ...DEFAULT_KAIKKI_SETTINGS, ...value?.kaikki },
    cvdict: { ...DEFAULT_CVDICT_SETTINGS, ...value?.cvdict },
    srs: { ...DEFAULT_SRS_SETTINGS, ...value?.srs },
    tts: normalizeTtsSettings(value?.tts),
  };
}

/**
 * Unlike the other blocks this cannot be a plain spread: `rate` reaches storage
 * from a slider and from synced settings, so it is clamped rather than trusted.
 */
function normalizeTtsSettings(value: Partial<TtsSettings> | undefined): TtsSettings {
  const merged = { ...DEFAULT_TTS_SETTINGS, ...value };
  return {
    voiceName:
      typeof merged.voiceName === 'string' && merged.voiceName !== ''
        ? merged.voiceName
        : null,
    rate: clampTtsRate(merged.rate),
    allowNetworkVoices: merged.allowNetworkVoices === true,
  };
}
```

- [ ] **Step 7: Add the mutator**

Append next to `setSrsSettings` in `lib/settings.ts`:

```ts
export function setTtsSettings(
  settings: AppSettings,
  tts: TtsSettings,
): AppSettings {
  return { ...settings, tts };
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run tests/settings.test.ts`
Expected: PASS.

- [ ] **Step 9: Run the full suite and commit**

Other suites construct `AppSettings` literals and will fail to type-check if any is missing `tts`.

```bash
npm run compile
npx vitest run
git add lib/settings.ts lib/types.ts tests/settings.test.ts
git commit -m "feat(settings): add TTS voice, rate, and network-voice settings"
```

If `npm run compile` reports missing `tts` in an `AppSettings` literal in another test, add `tts: DEFAULT_TTS_SETTINGS` to that literal and include the file in the commit.

---

### Task 3: Wire ranking, configuration, routing, and rate into `lib/tts.ts`

**Files:**
- Modify: `lib/tts.ts`
- Test: `tests/tts.test.ts`

**Interfaces:**
- Consumes: `VoiceCandidate`, `DEFAULT_TTS_SETTINGS`, `listChineseVoices`, `selectVoice` from `lib/tts-voices.ts`; `TtsSettings` from `lib/types.ts`.
- Produces:
  - `function configureTts(next: TtsSettings): void`
  - `function listVoiceCandidates(): VoiceCandidate[]`
  - `function getSelectedVoiceName(): string | null`
  - existing `initTts`, `getTtsState`, `isChineseVoiceAvailable`, `subscribeTts`, `speak`, `stop` keep their signatures.

- [ ] **Step 1: Extend the test mocks**

In `tests/tts.test.ts`, replace `createMockVoice` and `createMockChromeTts` so tests can express remoteness and OS-default:

```ts
function createMockVoice(
  lang: string,
  name: string,
  options: { isDefault?: boolean; localService?: boolean } = {},
): SpeechSynthesisVoice {
  return {
    default: options.isDefault ?? false,
    lang,
    localService: options.localService ?? true,
    name,
    voiceURI: name,
  };
}
```

```ts
type MockChromeTtsVoice = {
  lang?: string;
  voiceName?: string;
  remote?: boolean;
};
```

- [ ] **Step 2: Write the failing tests**

Append inside the existing `describe('tts', ...)` block in `tests/tts.test.ts`:

```ts
  it('picks Tingting over the novelty voice Chrome lists first', async () => {
    const { speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Tingting');
  });

  it('reports unavailable when only novelty voices exist', async () => {
    const { isChineseVoiceAvailable } = await initWithVoices([
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
    ]);

    expect(isChineseVoiceAvailable()).toBe(false);
  });

  it('uses the configured voice name', async () => {
    const { configureTts, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-TW', 'Meijia'),
    ]);

    configureTts({ voiceName: 'Meijia', rate: 1, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Meijia');
  });

  it('keeps a saved voice name that is not installed and falls back', async () => {
    const { configureTts, getSelectedVoiceName, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    configureTts({ voiceName: 'Removed Voice', rate: 1, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Tingting');
    expect(getSelectedVoiceName()).toBe('Tingting');
  });

  it('applies the configured rate to Web Speech', async () => {
    const { configureTts, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    configureTts({ voiceName: null, rate: 0.7, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].rate).toBe(0.7);
  });

  it('applies the configured rate to chrome tts', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, speak } = await importTts();

    initTts();
    configureTts({ voiceName: null, rate: 0.6, allowNetworkVoices: false });
    speak('你好');

    expect(chromeTts.speak).toHaveBeenCalledWith(
      '你好',
      expect.objectContaining({ rate: 0.6 }),
    );
  });

  it('routes to Web Speech for a voice chrome tts does not have', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, speak } = await importTts();

    mockVoices = [
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-CN', 'Web Only Voice'),
    ];
    initTts();
    speakCalls = [];

    configureTts({ voiceName: 'Web Only Voice', rate: 1, allowNetworkVoices: false });
    speak('你好');

    expect(chromeTts.speak).not.toHaveBeenCalled();
    expect(speakCalls[0].voice?.name).toBe('Web Only Voice');
  });

  it('ignores remote voices until network voices are allowed', async () => {
    const { configureTts, isChineseVoiceAvailable } = await initWithVoices([
      createMockVoice('zh-CN', 'Google 普通话', { localService: false }),
    ]);

    expect(isChineseVoiceAvailable()).toBe(false);

    configureTts({ voiceName: null, rate: 1, allowNetworkVoices: true });

    expect(isChineseVoiceAvailable()).toBe(true);
  });

  it('lists Chinese voices for the picker, including ones never auto-selected', async () => {
    const { listVoiceCandidates } = await initWithVoices([
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('en-US', 'Samantha'),
    ]);

    expect(listVoiceCandidates().map((voice) => voice.name)).toEqual([
      'Tingting',
      'Eddy (Chinese (China mainland))',
    ]);
  });

  it('merges a voice present in both engines into one candidate', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { initTts, listVoiceCandidates } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Tingting', { isDefault: true })];
    initTts();

    const candidates = listVoiceCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].engines).toEqual(expect.arrayContaining(['web', 'chrome']));
    expect(candidates[0].isDefault).toBe(true);
  });
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/tts.test.ts`
Expected: FAIL — `configureTts is not a function`, and the Tingting-over-Eddy test fails because selection still returns Eddy.

- [ ] **Step 4: Rewrite the selection and playback internals**

In `lib/tts.ts`, replace the imports and module state at the top of the file:

```ts
import type { Browser } from 'wxt/browser';
import {
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
let listenerRegistered = false;
let chromeListenerRegistered = false;
```

Delete the old `chromeVoice` / `chineseVoice` declarations and the two `pick*ChineseVoice` functions — `lib/tts-voices.ts` replaces them.

Add candidate collection and resolution:

```ts
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
```

Replace `updateAvailableState` so availability follows the resolved selection:

```ts
function updateAvailableState(): TtsState {
  resolveSelection();

  if (selected) {
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
```

Replace the bodies of `refreshChromeVoices` and `refreshVoices` so they only cache raw lists:

```ts
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
```

In `initTts`, replace the `chineseVoice = null` line in the no-synth branch with `webVoices = [];`.

Replace `isChineseVoiceAvailable` and add the new exports:

```ts
export function isChineseVoiceAvailable(): boolean {
  return selected !== null;
}

/** Push the user's saved preferences in. Keeps this module free of storage imports. */
export function configureTts(next: TtsSettings): void {
  settings = next;
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
```

Replace `speak` so the resolved voice picks the engine:

```ts
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
```

In `speakWithChromeTts`, replace the `lang` line and the `speak` options:

```ts
  const lang = selected?.lang || 'zh-CN';
```

```ts
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
          setState(selected ? { status: 'idle' } : { status: 'unavailable' });
        }
      },
    });
```

In `speakWithWebSpeech`, replace the guard and utterance setup:

```ts
function speakWithWebSpeech(text: string): void {
  const synth = getSynth();
  const voice = findWebVoice(selected?.name);
  if (!synth || !voice || typeof SpeechSynthesisUtterance === 'undefined') {
    activeUtterance = null;
    setState({ status: 'unavailable' });
    return;
  }

  if (activeUtterance) {
    activeUtterance = null;
    synth.cancel();
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.rate = settings.rate;
```

The rest of `speakWithWebSpeech` is unchanged.

In `stop`, replace both `chineseVoice`/`chromeVoice` availability checks with `selected`:

```ts
    setState(selected ? { status: 'idle' } : { status: 'unavailable' });
```

and

```ts
  setState(selected ? { status: 'idle' } : { status: 'unavailable' });
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/tts.test.ts`
Expected: PASS. All pre-existing tests must still pass — the ranking keeps `Ting-Ting` ahead of `Google Mandarin` in the chrome-preference test, and `Mei-Jia` remains eligible as a `zh-TW` fallback.

- [ ] **Step 6: Type-check and commit**

```bash
npm run compile
git add lib/tts.ts tests/tts.test.ts
git commit -m "fix(tts): select the best Chinese voice and route to the owning engine"
```

---

### Task 4: i18n keys

**Files:**
- Modify: `lib/i18n.ts`
- Test: `tests/i18n.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: message keys `tts.settingsTitle`, `tts.voice`, `tts.voiceAuto`, `tts.rate`, `tts.test`, `tts.testSample`, `tts.allowNetwork`, `tts.allowNetworkHint`, `tts.noNetworkVoices`, `tts.badgeNetwork`, `tts.badgeSystem`, `tts.noVoices`, `tts.voiceMissing`.

- [ ] **Step 1: Write the failing test**

Append to `tests/i18n.test.ts` inside `describe('i18n messages', ...)`:

```ts
  it('defines every pronunciation settings key in both locales', () => {
    const keys = [
      'tts.speak',
      'tts.settingsTitle',
      'tts.voice',
      'tts.voiceAuto',
      'tts.rate',
      'tts.test',
      'tts.testSample',
      'tts.allowNetwork',
      'tts.allowNetworkHint',
      'tts.noNetworkVoices',
      'tts.badgeNetwork',
      'tts.badgeSystem',
      'tts.noVoices',
      'tts.voiceMissing',
    ] as const;

    for (const key of keys) {
      expect(messages.en[key], `missing en: ${key}`).toBeTruthy();
      expect(messages['zh-CN'][key], `missing zh-CN: ${key}`).toBeTruthy();
    }
  });

  it('names the pronunciation panel in both locales', () => {
    expect(t('en', 'tts.settingsTitle')).toBe('Pronunciation');
    expect(t('zh-CN', 'tts.settingsTitle')).toBe('发音');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/i18n.test.ts`
Expected: FAIL — TypeScript rejects the unknown keys, or the assertions report `missing en: tts.settingsTitle`.

- [ ] **Step 3: Add the English keys**

In `lib/i18n.ts`, immediately after `'tts.speak': 'Pronounce',` in the `en` block:

```ts
    'tts.settingsTitle': 'Pronunciation',
    'tts.voice': 'Voice',
    'tts.voiceAuto': 'Auto (best available)',
    'tts.rate': 'Speed',
    'tts.test': 'Test',
    'tts.testSample': '这个词的发音',
    'tts.allowNetwork': 'Allow network voices',
    'tts.allowNetworkHint': 'Network voices send the spoken text to the voice provider.',
    'tts.noNetworkVoices': 'This browser reports no network voices.',
    'tts.badgeNetwork': 'Network',
    'tts.badgeSystem': 'System',
    'tts.noVoices': 'No Chinese voice is installed on this system.',
    'tts.voiceMissing': 'The saved voice is unavailable; using the best available one.',
```

- [ ] **Step 4: Add the zh-CN keys**

Immediately after `'tts.speak': '发音',` in the `zh-CN` block:

```ts
    'tts.settingsTitle': '发音',
    'tts.voice': '语音',
    'tts.voiceAuto': '自动（最佳可用）',
    'tts.rate': '语速',
    'tts.test': '试听',
    'tts.testSample': '这个词的发音',
    'tts.allowNetwork': '允许网络语音',
    'tts.allowNetworkHint': '网络语音会将朗读文本发送给语音提供方。',
    'tts.noNetworkVoices': '此浏览器未提供网络语音。',
    'tts.badgeNetwork': '网络',
    'tts.badgeSystem': '系统',
    'tts.noVoices': '系统未安装中文语音。',
    'tts.voiceMissing': '已保存的语音不可用，正在使用最佳可用语音。',
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run tests/i18n.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
npm run compile
git add lib/i18n.ts tests/i18n.test.ts
git commit -m "feat(i18n): add pronunciation settings strings"
```

---

### Task 5: Pronunciation settings panel

**Files:**
- Create: `entrypoints/settings/TtsSettingsPanel.tsx`
- Modify: `entrypoints/settings/SettingsApp.tsx`
- Modify: `PRIVACY.md`
- Test: `tests/tts-settings-panel.test.tsx`

**Interfaces:**
- Consumes: `configureTts`, `initTts`, `listVoiceCandidates`, `getSelectedVoiceName`, `speak` from `lib/tts.ts`; `MIN_TTS_RATE`, `MAX_TTS_RATE` from `lib/tts-voices.ts`; `setTtsSettings` from `lib/settings.ts`; `t` from `lib/i18n.ts`.
- Produces: `TtsSettingsPanel({ settings, locale, onSave }: { settings: TtsSettings; locale: UiLocale; onSave: (next: TtsSettings) => void })`.

> The panel calls `configureTts` with its own draft so **Test** previews the pending selection. The settings page and the dashboard are separate documents with separate module instances, so this cannot disturb the dashboard's playback.

- [ ] **Step 1: Write the failing tests**

Create `tests/tts-settings-panel.test.tsx`:

```tsx
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsSettingsPanel } from '../entrypoints/settings/TtsSettingsPanel';
import { DEFAULT_TTS_SETTINGS } from '../lib/tts-voices';

const listVoiceCandidates = vi.fn();
const getSelectedVoiceName = vi.fn(() => 'Tingting');

vi.mock('../lib/tts', () => ({
  configureTts: vi.fn(),
  initTts: vi.fn(),
  speak: vi.fn(),
  getTtsState: () => ({ status: 'idle' }),
  subscribeTts: () => () => {},
  listVoiceCandidates: () => listVoiceCandidates(),
  getSelectedVoiceName: () => getSelectedVoiceName(),
}));

function voice(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    lang: 'zh-CN',
    isRemote: false,
    isDefault: false,
    engines: ['web'],
    index: 0,
    ...overrides,
  };
}

describe('TtsSettingsPanel', () => {
  beforeEach(() => {
    listVoiceCandidates.mockReturnValue([voice('Tingting')]);
    getSelectedVoiceName.mockReturnValue('Tingting');
  });

  it('renders the voice, rate, and network controls', () => {
    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('Pronunciation');
    expect(html).toContain('Voice');
    expect(html).toContain('Speed');
    expect(html).toContain('Allow network voices');
    expect(html).toContain('Tingting');
    expect(html).toContain('Auto (best available)');
  });

  it('disables remote voices until network voices are allowed', () => {
    listVoiceCandidates.mockReturnValue([
      voice('Tingting'),
      voice('Google 普通话', { isRemote: true, index: 1 }),
    ]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('Network');
    expect(html).toMatch(/<option[^>]*disabled[^>]*>[^<]*Google 普通话/);
  });

  it('enables remote voices once allowed', () => {
    listVoiceCandidates.mockReturnValue([
      voice('Google 普通话', { isRemote: true, index: 1 }),
    ]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel
        settings={{ ...DEFAULT_TTS_SETTINGS, allowNetworkVoices: true }}
        locale="en"
        onSave={vi.fn()}
      />,
    );

    expect(html).not.toMatch(/<option[^>]*disabled[^>]*>[^<]*Google 普通话/);
  });

  it('flags the OS system voice', () => {
    listVoiceCandidates.mockReturnValue([voice('Tingting', { isDefault: true })]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('System');
  });

  it('warns when the saved voice is unavailable', () => {
    getSelectedVoiceName.mockReturnValue('Tingting');

    const html = renderToStaticMarkup(
      <TtsSettingsPanel
        settings={{ ...DEFAULT_TTS_SETTINGS, voiceName: 'Removed Voice' }}
        locale="en"
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('The saved voice is unavailable');
  });

  it('explains the empty state instead of rendering dead controls', () => {
    listVoiceCandidates.mockReturnValue([]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('No Chinese voice is installed on this system.');
    expect(html).not.toContain('Speed');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/tts-settings-panel.test.tsx`
Expected: FAIL — `Failed to resolve import "../entrypoints/settings/TtsSettingsPanel"`.

- [ ] **Step 3: Write the panel**

Create `entrypoints/settings/TtsSettingsPanel.tsx`:

```tsx
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
    setDraft({ ...settings });
  }, [settings]);

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
  const savedVoiceMissing =
    draft.voiceName !== null && !voices.some((voice) => voice.name === draft.voiceName);

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
            {savedVoiceMissing ? (
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/tts-settings-panel.test.tsx`
Expected: PASS, 6 tests.

- [ ] **Step 5: Render the panel in `SettingsApp.tsx`**

Add to the `@/lib/settings` import list: `setTtsSettings`. Add a component import next to the `AiSettingsPanel` import:

```ts
import { TtsSettingsPanel } from './TtsSettingsPanel';
```

Add a handler next to `updateLocale`:

```ts
  async function updateTtsSettings(tts: TtsSettings) {
    await mutate((current) => setTtsSettings(current, tts));
  }
```

Add `TtsSettings` to the `@/lib/types` type import. Render the panel immediately before `<AiSettingsPanel ... />`:

```tsx
        <TtsSettingsPanel
          settings={settings.tts}
          locale={locale}
          onSave={(next) => void updateTtsSettings(next)}
        />
```

- [ ] **Step 6: Document the network-voice behaviour**

Append to the data-handling section of `PRIVACY.md`:

```markdown
### Pronunciation (text-to-speech)

Pronunciation uses the speech voices your browser and operating system already
provide. By default only on-device voices are used, and nothing leaves your
computer.

Some platforms also offer network voices, which synthesize speech on a remote
server. These are disabled by default. If you enable **Allow network voices** in
Settings → Pronunciation and then select one, the word or phrase being spoken is
sent to that voice's provider. No other data is included, and the setting can be
turned off at any time.
```

- [ ] **Step 7: Verify and commit**

```bash
npm run compile
npx vitest run
git add entrypoints/settings/TtsSettingsPanel.tsx entrypoints/settings/SettingsApp.tsx tests/tts-settings-panel.test.tsx PRIVACY.md
git commit -m "feat(tts): add a pronunciation settings panel with voice and speed"
```

---

### Task 6: Dashboard wiring and release notes

**Files:**
- Modify: `entrypoints/dashboard/App.tsx`
- Modify: `CHANGELOG.md`

**Interfaces:**
- Consumes: `configureTts` from `lib/tts.ts`; `settings.tts` from the existing `useSettings()` call.
- Produces: nothing.

- [ ] **Step 1: Push settings into the TTS module**

In `entrypoints/dashboard/App.tsx`, add the import:

```ts
import { configureTts } from '@/lib/tts';
```

Add an effect immediately after the existing `useSettings()` destructure:

```ts
  useEffect(() => {
    configureTts(settings.tts);
  }, [settings.tts]);
```

If `useEffect` is not already imported from `react` in this file, add it.

- [ ] **Step 2: Verify the wiring compiles and the suite is green**

```bash
npm run compile
npx vitest run
```

Expected: no type errors; all suites pass.

- [ ] **Step 3: Build and confirm the extension still packages**

```bash
npm run build
```

Expected: build completes without errors.

- [ ] **Step 4: Manual verification**

Load the built extension, then confirm all four:

1. Save a Chinese word and click its speak button — the voice is a real Mandarin
   voice, not a novelty one.
2. Settings → Pronunciation lists the installed Chinese voices, with `Auto` first.
3. Changing the voice and pressing **Test** changes the voice you hear.
4. Lowering **Speed** and clicking a word's speak button on the dashboard slows
   playback.

Note in the commit message if any step could not be verified.

- [ ] **Step 5: Add the changelog entry**

Under a new `## Unreleased` heading in `CHANGELOG.md` (or the existing one):

```markdown
### Fixed

- Pronunciation picked whichever Chinese voice the browser happened to list
  first, which on macOS is a novelty voice rather than a real Mandarin one.
  Voices are now ranked, and the operating system's own Chinese voice setting is
  respected.

### Added

- Settings → Pronunciation: choose the speech voice and playback speed, preview
  them, and optionally allow network voices (off by default).
```

- [ ] **Step 6: Commit**

```bash
git add entrypoints/dashboard/App.tsx CHANGELOG.md
git commit -m "feat(tts): apply saved pronunciation settings on the dashboard"
```

---

### Task 7: Decision record for the dropped warm-up

**Files:**
- Modify: `docs/superpowers/specs/2026-08-11-tts-voice-quality-design.md`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing.

The spec calls for a priming utterance to work around Chrome silently dropping
the first `speechSynthesis.speak()` of a session. It is not implemented, and the
spec must say so rather than leaving a requirement that looks forgotten.

Three existing tests in `tests/tts.test.ts` encode the current contract, and a
warm-up breaks them in ways that are not merely cosmetic:

- `detects a zh-CN voice without speaking before a user click` — asserts nothing
  is spoken on load. Eager warm-up violates this, and the assertion protects a
  real property: browsers block audio before user interaction.
- `does not cancel before first idle speech` — a warm-up that cancels itself
  violates this.
- `speaks text with the Chinese voice` — asserts exactly one `speak()` call.
  Any warm-up on the first utterance makes it two.

The bug being mitigated is old, is not reproducible on current Chrome, and was
never reported for this extension. Rewriting three behavioural tests to
accommodate a fix for an unobserved bug is not a good trade.

- [ ] **Step 1: Replace the Warm-up section**

Replace the `### Warm-up` section with:

```markdown
### Warm-up (not implemented)

The original TTS design specified a `warmedUp`-guarded silent utterance to work
around Chrome dropping the first `speechSynthesis.speak()` of a session. It is
deliberately not implemented.

Three tests in `tests/tts.test.ts` assert that nothing is spoken before a user
click, that no cancel precedes the first utterance, and that speaking a word
produces exactly one `speak()` call. Every warm-up placement violates at least
one of them, and the first of those assertions guards a real property — browsers
block audio before user interaction.

The bug is old, is not reproducible on current Chrome, and has never been
reported for this extension. Revisit only if a dropped first utterance is
actually observed; the fix would then be a non-cancelling primer on the first
`speak()` call, which costs only the one-utterance-per-word assertion.
```

- [ ] **Step 2: Remove the warm-up from the Goals list**

Delete this line from the `## Goals` section:

```markdown
- Ship the warm-up utterance the original design specified but never landed.
```

- [ ] **Step 3: Add the two i18n keys the spec's table omits**

Implementation needed two strings the spec did not anticipate. Add them to the
i18n table in the spec's `## UI` section so it matches what shipped:

```markdown
| `tts.testSample` | 这个词的发音 | 这个词的发音 |
| `tts.noNetworkVoices` | This browser reports no network voices. | 此浏览器未提供网络语音。 |
```

- [ ] **Step 4: Correct the ranking table's `isDefault` row**

The spec claims "`isDefault` outscores every combination of the rest". That is
false as arithmetic — the other bonuses sum to 125 against a 100 bonus — and the
implementation tiers on `isDefault` before consulting the score instead. In the
`### Ranking` section, remove the `isDefault` row from the score table and
replace the sentence beginning "`isDefault` outscores every combination" with:

```markdown
Ordering tiers on `isDefault` first and only falls back to the score table
below, so an explicit OS choice wins by construction: name-based bonuses can
stack past any fixed bonus, so a bonus large enough "today" is not a guarantee.
Eloquence voices cannot reach the comparator at all, so an Eloquence OS default
is skipped rather than selected.
```

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/specs/2026-08-11-tts-voice-quality-design.md
git commit -m "docs(tts): record why the warm-up utterance was dropped"
```

---

## Verification

After every task:

```bash
npm run compile
npx vitest run
```

The change is complete when both pass, `npm run build` succeeds, and the four
manual checks in Task 6 Step 4 hold.
