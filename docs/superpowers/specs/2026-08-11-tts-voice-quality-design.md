# TTS Voice Quality Design

Supersedes the voice-selection portions of
[2026-06-22-tts-design.md](2026-06-22-tts-design.md). The engine choice
(Chrome `tts` API with Web Speech fallback) and the ephemeral, nothing-persisted
playback model are unchanged.

## Problem

Pronunciation quality is bad. The cause is voice *selection*, not the speech
engine.

`lib/tts.ts` picks a voice with:

```ts
const zhCN = voices.find((voice) => voice.lang === 'zh-CN');
```

The first `zh-CN` entry Chrome reports is not the best voice — it is an
arbitrary one. On a macOS 26.5.2 test machine the list began with
`Eddy (Chinese (China mainland))`, so the extension read every word in a
novelty voice.

## Findings

Measured on macOS 26.5.2, Chrome, via `speechSynthesis.getVoices()` and
`AVSpeechSynthesisVoice.speechVoices()`.

1. **18 `zh-*` voices exist; 17 are unsuitable.** Nine are Eloquence formant
   voices (`com.apple.eloquence.zh-CN.{Eddy,Flo,Grandma,Grandpa,Reed,Rocko,Sandy,Shelley}`),
   duplicated across `zh-CN` and `zh-TW`. Eloquence is a 1980s-era synthesizer
   bundled for accessibility; it is intelligible but robotic by design.
2. **The only real Mandarin voice is `super-compact`.**
   `com.apple.voice.super-compact.zh-CN.Tingting` is Apple's lowest quality
   tier. Its flat, syllable-by-syllable delivery is an accurate description of
   the tier, not a bug.
3. **No Enhanced or Premium Chinese voice is downloadable.** Zero of the
   machine's 180 voices report a non-default quality tier, and the macOS 26
   voice sheet (Accessibility → Read & Speak → System Voice → Manage Voices)
   offers no download for Chinese (China mainland). Apple's higher-quality
   Mandarin voices are Siri voices, which are not exposed to third-party TTS.
4. **No network voices exist.** All 18 report `localService: true`. Chrome's
   remote Google voices ship on ChromeOS or via TTS-engine extensions, not on
   desktop macOS.
5. **Chrome mirrors Apple's catalog one-for-one** — 18 zh voices in Chrome, 18
   in `AVSpeechSynthesisVoice`, same names. Newly installed system voices will
   therefore appear in Chrome after a browser restart.
6. **`voice.default` tracks the OS System Voice setting, and Chrome sorts the
   default voice to index 0.** Setting System Voice to Tingting moved it from
   index 17 to index 0 with `default: true`. This is both a strong ranking
   signal and the reason the defect is invisible to anyone who has already set a
   Chinese System Voice.

### Consequence

Finding 6 means the current code accidentally works for users whose OS default
is already a Chinese voice, and fails for everyone else — most users, since a
Mac in an English or Vietnamese locale defaults to an English voice and leaves
no `zh` voice flagged `default`.

Finding 3 caps what this work can achieve: correct selection replaces a novelty
voice with a real but `super-compact` one. That is a large improvement and not a
natural-sounding one. Cloud neural TTS was considered and deferred; see
[Deferred](#deferred).

## Goals

- Never auto-select an Eloquence novelty voice.
- Respect the user's OS System Voice choice above any built-in heuristic.
- Let the user pick a voice and playback rate explicitly, and hear the result
  before committing.
- Support remote/network voices where they exist, behind an opt-in that is off
  by default.
- Route playback to the engine that actually owns the selected voice.
- Ship the warm-up utterance the original design specified but never landed.

## Non-Goals

- No cloud TTS provider. See [Deferred](#deferred).
- No pitch control. Rate is the only playback parameter learners need.
- No per-word voice override. One voice per collection.
- No TTS on Quote cards. Unchanged from the original design.
- No attempt to correct 多音字 readings. The engine reads isolated words with no
  context; fixing that needs phoneme-level input the Web Speech API does not
  accept. `ToneChips` and pinyin remain the visual source of truth.

## Architecture

### Voice metadata unification

Chrome exposes two voice lists with different shapes, and neither is a superset:

| Source | Provides | Missing |
| --- | --- | --- |
| `speechSynthesis.getVoices()` | `name`, `lang`, `localService`, `default` | voices from TTS-engine extensions |
| `chrome.tts.getVoices()` | `voiceName`, `lang`, `remote`, `extensionId` | `default` |

`lib/tts.ts` normalizes both into one shape:

```ts
type VoiceCandidate = {
  name: string;          // 'Tingting', 'Eddy (Chinese (China mainland))'
  lang: string;
  isRemote: boolean;     // !localService, or chrome's remote
  isDefault: boolean;    // Web Speech only; false for chrome-only voices
  engines: Array<'chrome' | 'web'>;
  index: number;         // position in its source list, for stable tie-breaks
};
```

Candidates are merged by `name`. A voice present in both lists carries both
engines and inherits `isDefault` from the Web Speech entry — this is what lets
the OS-default signal survive even though playback prefers `chrome.tts`.

### Ranking

Auto-selection applies a hard filter, then scores the survivors.

**Hard filters** (excluded from auto-selection, still listed in the picker):

- Name's leading token is in the Eloquence set: `Eddy`, `Flo`, `Grandma`,
  `Grandpa`, `Reed`, `Rocko`, `Sandy`, `Shelley`. Matching is on the token
  before `' ('`, because Web Speech renders these as
  `Eddy (Chinese (China mainland))` while `chrome.tts` renders them as `Eddy`.
- `isRemote` and `allowNetworkVoices` is false.

**Score** (highest wins; ties break on lower `index`):

| Signal | Points |
| --- | --- |
| `isDefault` — the user's own OS System Voice | +100 |
| Name contains `Premium` | +40 |
| Name contains `Enhanced` or `Neural` | +30 |
| Known-good family: `Tingting`, `婷婷`, `Huihui`, `Yaoyao`, `Xiaoxiao`, `Yunxi`, `Yunyang`, `Google 普通话` | +20 |
| `isRemote` (only reachable when opted in) | +25 |
| `lang === 'zh-CN'` | +10 |

`isDefault` outscores every combination of the rest, so an explicit OS choice
always wins. Eloquence voices cannot reach the scorer, so an Eloquence OS
default cannot be auto-selected — it is simply skipped.

Ranking is pure and synchronous over `VoiceCandidate[]`, which makes it directly
unit-testable with no DOM mocking.

### Engine routing

Current `speak()` prefers `chrome.tts` whenever it holds any voice, which would
override a Web-Speech-only voice the user explicitly picked. New rule:
**resolve the voice first, then pick the engine that owns it.**

1. If `settings.voiceName` matches a candidate, use it.
2. Otherwise auto-select by rank.
3. Play through `chrome.tts` if the resolved candidate lists the `chrome`
   engine; otherwise through Web Speech.

When the stored `voiceName` matches nothing — voice uninstalled, or settings
synced from another machine — fall back to auto-selection **without clearing the
stored value**, so the preference re-binds if the voice returns. The panel
surfaces this as an inline notice.

### Settings

```ts
export interface TtsSettings {
  voiceName: string | null;      // null = auto-select by rank
  rate: number;                  // 0.5 – 1.5
  allowNetworkVoices: boolean;
}

export const DEFAULT_TTS_SETTINGS: TtsSettings = {
  voiceName: null,
  rate: 1,
  allowNetworkVoices: false,
};
```

Added to `AppSettings` alongside `srs`, with a `setTtsSettings` mutator matching
the existing `setSrsSettings` shape. `normalizeSettings` merges over
`DEFAULT_TTS_SETTINGS` and clamps `rate` into `[0.5, 1.5]`, guarding against
hand-edited or corrupted storage. The `StoredAppSettings` type gains `tts` in
both its `Omit` list and its partial-field block.

`rate` defaults to `1`, preserving today's behaviour. The reported problem is
quality, not speed; the slider exists for learners who want it.

**`lib/tts.ts` stays storage-free.** It gains:

```ts
export function configureTts(settings: TtsSettings): void;
```

The dashboard root calls this whenever settings load or change. Keeping storage
out of `lib/tts.ts` preserves the pure-DOM unit-testability the original design
deliberately protected, and lets the settings page drive the module directly for
its Test button without a storage round-trip.

Changing `voiceName` or `allowNetworkVoices` re-resolves the active voice
immediately. Changing `rate` takes effect on the next utterance; in-flight
speech is not restarted.

### Warm-up

Ship the `warmedUp`-guarded priming utterance from
[the original design](2026-06-22-tts-design.md) — a `volume: 0` one-character
utterance spoken and immediately cancelled once per session, after the voice
list first resolves. Scoped to the **Web Speech path only**; the dropped-first-
utterance bug is a Web Speech bug and `chrome.tts` does not exhibit it.

## UI

### New component: `entrypoints/settings/TtsSettingsPanel.tsx`

Its own file rather than a section appended to `SettingsApp.tsx`, which is
already 788 lines. Mirrors `AiSettingsPanel`'s props-in/callbacks-out shape, so
`SettingsApp` gains an import and a render site but no new logic.

Contents:

- **Voice dropdown.** All `zh-*` candidates, ordered by rank. An `Auto` option
  at the top maps to `voiceName: null`. Entries carry badges: `Network` for
  remote voices, `System` for the OS default. Remote entries are disabled unless
  the toggle below is on.
- **Allow network voices toggle.** Off by default. Its description states that
  the selected text is sent to the voice provider. When no remote voice exists —
  the case on macOS — the toggle renders with an explanatory note rather than
  silently doing nothing.
- **Rate slider.** `0.5`–`1.5`, step `0.1`, with the numeric value shown.
- **Test button.** Speaks a fixed sample (`这个词的发音`) with the pending
  selection, so voices can be compared without leaving the page.
- **Unavailable state.** When no `zh-*` voice exists at all, the panel renders
  an explanatory message instead of dead controls, matching `SpeakButton`'s
  existing decision to render nothing.

### `SpeakButton.tsx`

Unchanged in behaviour. It continues to call `initTts()` and subscribe; voice
and rate now come from module state that the dashboard root configures.

### i18n

New keys in both `en` and `zh-CN`:

| Key | en | zh-CN |
| --- | --- | --- |
| `tts.settingsTitle` | Pronunciation | 发音 |
| `tts.voice` | Voice | 语音 |
| `tts.voiceAuto` | Auto | 自动 |
| `tts.rate` | Speed | 语速 |
| `tts.test` | Test | 试听 |
| `tts.allowNetwork` | Allow network voices | 允许网络语音 |
| `tts.allowNetworkHint` | Network voices send the text to the voice provider. | 网络语音会将文本发送给语音提供方。 |
| `tts.badgeNetwork` | Network | 网络 |
| `tts.badgeSystem` | System | 系统 |
| `tts.noVoices` | No Chinese voice is installed on this system. | 系统未安装中文语音。 |
| `tts.voiceMissing` | The saved voice is unavailable; using the best available one. | 已保存的语音不可用，正在使用最佳可用语音。 |

## Testing

### `tests/tts.test.ts` (extend)

Ranking is pure, so most cases need no DOM mock:

- Tingting outranks Eddy when both are present — the reported defect.
- Eloquence names are excluded from auto-selection across both the
  `Eddy (Chinese (China mainland))` and bare `Eddy` spellings.
- `isDefault` beats a higher-scoring non-default voice.
- An Eloquence voice flagged `isDefault` is still not auto-selected.
- Remote voices are excluded when `allowNetworkVoices` is false and eligible
  when true.
- Equal scores break toward the lower source index (determinism).
- An explicit `voiceName` is honoured over the ranking.
- An unmatched `voiceName` falls back to ranking and leaves the setting intact.

Behavioural cases against the existing mocks:

- Playback routes to Web Speech for a web-only voice even when `chrome.tts` has
  voices — the routing regression this design fixes.
- `rate` reaches both `chrome.tts.speak` options and the
  `SpeechSynthesisUtterance`.
- The warm-up fires once per session, on the Web Speech path only.
- `configureTts` re-resolves the active voice.

### `tests/settings.test.ts` (extend)

- `tts` defaults are applied when absent from stored settings.
- `rate` is clamped at both bounds.
- `setTtsSettings` preserves unrelated settings.

### `tests/tts-settings-panel.test.tsx` (new)

`AiSettingsPanel` has component coverage in `tests/ai-settings-panel.test.tsx`,
so the new panel follows that precedent rather than shipping untested:

- Remote voices render disabled until `allowNetworkVoices` is on.
- Selecting a voice invokes the save callback with that `voiceName`; choosing
  `Auto` saves `null`.
- The rate slider reports its value through the save callback.
- The no-voices state renders the explanatory message instead of the controls.

### `tests/i18n.test.ts` (extend)

Assert every new `tts.*` key exists in both locales.

## Documentation

- `PRIVACY.md` gains a paragraph on network voices: off by default, and when
  enabled the spoken text is sent to the voice provider.
- `CHANGELOG.md` entry noting the corrected voice selection, since users on the
  novelty voice will hear an abrupt change.

## Verification

```bash
npm run compile
npm test
```

Manual check, which no unit test can cover: load the extension, confirm the
spoken voice is Tingting rather than Eddy, then confirm the picker's Test button
switches voices audibly.

## Deferred

**Cloud neural TTS.** The only path to natural-sounding Mandarin on macOS, given
finding 3. Azure Speech's `zh-CN-XiaoxiaoNeural` has a permanently free tier of
500k characters/month — effectively unlimited for single words — and audio
cached in `unlimitedStorage` (~10KB per word) would make repeat plays offline
and instant. Deferred, not rejected: it needs an API key, a cache layer, and a
provider abstraction, and it is worth knowing whether corrected local selection
is sufficient before taking that on. If revisited, it should reuse the existing
`AiSettings` + `optional_host_permissions` pattern and fall back to the local
voice when no key is configured.
