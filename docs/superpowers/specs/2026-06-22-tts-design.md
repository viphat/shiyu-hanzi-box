# TTS (Text-to-Speech) Design

> Implementation update, 2026-06-24: the shipped implementation prefers the
> Chrome extension `tts` API and declares the required `tts` permission, with
> browser Web Speech as fallback. Chrome/OS or an installed speech engine
> supplies the voice, and Chrome reports that some installed voices may be
> remote. This supersedes the initial no-permission, Web-Speech-only assumptions
> below where they conflict with the implementation.

## Summary

Add a play/pronounce button to Word cards that reads the word aloud using the
browser-native `SpeechSynthesis` API. The feature is free, requires no API key,
adds zero bundle size, needs no new manifest permissions, and works offline using
the OS-level Chinese voice.

The button appears in the `WordCard` header row (after `PinyinButton`) and in
the `WordInsightPanel` / `ReviewInsightReveal` (after `ToneChips`). It always
reads the Simplified `word.text`, regardless of whether Traditional display is
active.

## Goals

- Let a reader hear any saved Word pronounced with one click.
- Use the browser-native `SpeechSynthesis` API — free, offline-capable, zero
  dependencies, no permissions.
- Provide clear button states: idle → speaking for the active word → back to
  idle.
- Support clicking the actively speaking button to stop playback; clicking a
  different word while speech is active replaces the current utterance.
- Prefer `zh-CN` voices; fall back to any `zh-*` voice if `zh-CN` is absent.
- Keep the TTS logic in a small, unit-testable module.
- Keep the feature confined to Word cards (not Quote cards).

## Non-Goals

- Do not add TTS to Quote cards. Quotes are sentences, often long; Chrome limits
  `SpeechSynthesis` to ~15 seconds per utterance and sentence-level TTS is a
  different UX.
- Do not ship a WASM-based neural TTS model (Piper, sherpa-onnx). OS-level
  voices are sufficient for a local-first extension and keep bundle size at zero.
- Do not add a speed/pitch/rate control UI. The default `SpeechSynthesis` rate
  is adequate for Chinese learners.
- Do not add TTS from the background service worker. All TTS occurs in the newtab
  dashboard, which has full DOM access.
- Do not add an `offscreen` document. Not needed since TTS is only triggered from
  the newtab page (a full DOM context).
- Do not read Traditional text when `traditionalText` is displayed. Always read
  `word.text` (the Simplified form) using `zh-CN`.
- Do not add TTS to the popup. The popup is a small utility; pronunciation
  belongs on the dashboard where the learner studies.
- Do not persist audio state or TTS settings. Voice selection and playback state
  are ephemeral.

## Current Project Context

The extension has no audio code, no TTS dependencies, and no audio-related
manifest permissions.

- `PinyinButton.tsx` is the closest UI analog: a small button in the card header
  that generates a value on click (pinyin), persists it, and switches to a static
  display. `SpeakButton` differs in that its output (audio) is ephemeral — there
  is nothing to persist.
- `ToneChips.tsx` shows per-character tone marks in the insight panel. A
  SpeakButton placed after it gives the learner an auditory complement to the
  visual tone display.
- `lib/pinyin.ts` and `lib/pinyin-helpers.ts` use `pinyin-pro` for text-only
  pinyin generation. TTS is complementary: pinyin shows *how to read*, TTS
  lets the learner *hear* it.
- `WordCard.tsx` header row layout:
  ```
  [Expand chevron] [Chinese text 32px] [PinyinButton] [TraditionalButton] ...
  ```
  SpeakButton slots in after `PinyinButton`, before `TraditionalButton`.
- `WordInsightPanel.tsx` renders `<ToneChips>` at line 30. SpeakButton goes
  immediately after it.
- `ReviewInsightReveal.tsx` renders `<ToneChips>` at line 37. SpeakButton goes
  immediately after it.
- `wxt.config.ts` currently has no `tts` permission. The `SpeechSynthesis` API is
  a standard DOM API that requires no manifest permission.

## TTS Engine

Use `window.speechSynthesis`, the browser-native Web Speech API.

- **Cost**: Free. No API key, no billing.
- **Network**: Offline-capable. Voices are provided by the OS or cached by
  Chrome. No network request is made for `speechSynthesis.speak()`.
- **Bundle size**: 0 bytes. No npm dependency.
- **Permission**: None. `SpeechSynthesis` is available in any DOM context without
  manifest permissions.
- **Chinese voices**: Chrome delegates to the OS TTS engine. Common Chinese voices:
  - macOS: "Ting-Ting (Enhanced)" (zh-CN)
  - Windows: "Microsoft Huihui Desktop" (zh-CN)
  - ChromeOS: "Google 简体中文" (zh-CN)
  - Linux: varies; some distributions lack Chinese voices entirely.
- **MV3 compatibility**: Fully available in newtab pages (full DOM context). Not
  available in service workers (no DOM), but that is irrelevant here — TTS is
  only triggered from the dashboard.

### Known limitations and mitigations

1. **`getVoices()` is async in Chrome.** Voices may not be available immediately
   on page load. Mitigation: listen for the `voiceschanged` event and cache the
   voice list on first resolution.
2. **First-utterance silence bug.** Some Chrome versions silently drop the very
   first `speechSynthesis.speak()` call. Mitigation: on voice list resolution,
   speak a one-character warm-up utterance (volume 0, rate 10) to prime the
   engine, then immediately cancel it.
3. **15-second Chrome limit.** Chrome cuts off speech after ~15 seconds. Not an
   issue for individual words; documented here as a known constraint for any
   future Quote-card TTS.
4. **No Chinese voice available.** On Linux or minimal environments, `getVoices()`
   may return no `zh-*` voice. Mitigation: `SpeakButton` is not rendered when no
   Chinese voice is detected. The tone chips and pinyin still serve as the visual
   fallback.

## Architecture

### New module: `lib/tts.ts`

A module that wraps `SpeechSynthesis` with voice selection and playback control:

```ts
export type TtsState =
  | { status: 'unavailable' }
  | { status: 'idle' }
  | { status: 'speaking'; text: string };

export type TtsListener = (state: TtsState) => void;

export function initTts(): TtsState;
export function getTtsState(): TtsState;
export function isChineseVoiceAvailable(): boolean;
export function subscribeTts(listener: TtsListener): () => void;
export function speak(text: string): void;
export function stop(): void;
```

- **Voice selection**: `initTts()` is idempotent. It calls
  `speechSynthesis.getVoices()`, registers one module-owned `voiceschanged`
  listener, and refreshes the cached voice when Chrome resolves the voice list.
  It prefers the first `zh-CN` voice and falls back to the first `zh-*` voice.
- **`isChineseVoiceAvailable()`**: Returns `true` if a cached Chinese voice
  exists. Used by `SpeakButton` to decide whether to render.
- **`subscribeTts(listener)`**: Registers React listeners for module state
  changes and returns an unsubscribe function. This avoids a per-button polling
  interval while still reacting to speech engine callbacks.
- **`speak(text)`**: If no Chinese voice exists, returns without doing anything.
  Otherwise calls `speechSynthesis.cancel()` first so a new word replaces any
  current or queued utterance. It creates a `SpeechSynthesisUtterance` with the
  cached Chinese voice, sets state to `{ status: 'speaking', text }`, calls
  `speechSynthesis.speak()`, then resets to `{ status: 'idle' }` on `onend` or
  `onerror`.
- **`stop()`**: Calls `speechSynthesis.cancel()`, resets state to
  `{ status: 'idle' }`, and notifies subscribers.
- **State tracking**: Module-level `TtsState` stores both status and active text.
  `SpeakButton` only renders the speaking state when
  `state.status === 'speaking' && state.text === props.text`.
- **Warm-up**: After the voice list resolves, creates a silent one-character
  utterance (`'一'`, volume 0, rate 10), speaks and immediately cancels it. This
  primes the engine once per dashboard session; the implementation must guard
  this with a module-level `warmedUp` flag.
- **No Chrome API dependency**: DOM API only. Unit-testable by mocking
  `speechSynthesis` on `window`.

### No type changes to `lib/types.ts`

TTS is ephemeral — nothing is persisted on `WordEntry` or `QuoteEntry`. No
schema changes.

### No manifest changes

`SpeechSynthesis` requires no permission. No change to `wxt.config.ts`.

### Data flow

1. `SpeakButton` mounts, calls `initTts()`, and subscribes with `subscribeTts()`.
2. `SpeakButton` renders if `isChineseVoiceAvailable()` returns `true`.
3. User clicks `SpeakButton`.
4. `SpeakButton` calls `speak(word.text)`.
5. `speak()` cancels any current or queued utterance and starts `word.text`.
6. Browser reads `word.text` aloud using the cached Chinese voice.
7. On utterance end or error, state resets to `idle`.
8. If user clicks the actively speaking word's `SpeakButton`, it calls `stop()`.

No changes to `lib/capture.ts`, `lib/normalize.ts`, `lib/storage.ts`,
`lib/markdown.ts`, `lib/export.ts`, or any `lib/ai/*` module.

## UI & Interaction

### New component: `SpeakButton.tsx`

A small icon button that toggles between idle and speaking states:

- **Props**: `{ text: string; locale: UiLocale }`.
- **Idle state**: Renders a `Volume2` icon (lucide-react) in muted style, with
  `title={t(locale, 'tts.speak')}` ("Pronounce" / "发音"). Clicking calls
  `speak(text)`.
- **Speaking state**: For the active word only, renders the same icon with a
  subtle pulse animation (`animate-pulse`), styled with `text-cinnabar`.
  Clicking calls `stop()`.
- **Another word is speaking**: The button stays in idle style; clicking it
  calls `speak(text)`, which replaces the current utterance.
- **Unavailable**: Returns `null`. Not rendered at all when no Chinese voice is
  detected.
- **`event.stopPropagation()`**: Prevents the click from toggling `WordCard`
  expand/collapse when the button is inside the header row.

The component calls `initTts()` once on mount and subscribes to `subscribeTts()`
inside `useEffect`. The returned unsubscribe function is called on unmount.

Style reference — matches the existing small button pattern in the card header:

```
rounded-sm p-1 text-muted transition hover:bg-paper-input hover:text-cinnabar
```

### `WordCard.tsx` changes

- Import `SpeakButton`.
- In the header's `flex items-center gap-2` row (line 40–66), place `SpeakButton`
  immediately after `PinyinButton` and before `TraditionalButton`:
  ```tsx
  <PinyinButton ... />
  <SpeakButton text={word.text} locale={locale} />
  <TraditionalButton ... />
  ```

### `WordInsightPanel.tsx` changes

- Import `SpeakButton`.
- After `<ToneChips chips={insight.toneChips} />` (line 30), add:
  ```tsx
  <SpeakButton text={word.text} locale={locale} />
  ```
  This gives learners an auditory complement to the visual tone chip display.

### `ReviewInsightReveal.tsx` changes

- Import `SpeakButton`.
- After `<ToneChips chips={insight.toneChips} />` in `RevealedReviewInsight`
  (line 37), add:
  ```tsx
  <SpeakButton text={word.text} locale={locale} />
  ```
  Consistent with the insight panel placement.

### i18n keys (`lib/i18n.ts`)

Add to both `en` and `zh-CN`:

| Key      | en         | zh-CN   |
| -------- | ---------- | ------- |
| `tts.speak` | `Pronounce` | `发音` |

## Testing

### `tests/tts.test.ts` (new)

Unit-test the `lib/tts.ts` module by mocking `window.speechSynthesis`:

- `isChineseVoiceAvailable()` returns `false` before voices load.
- `isChineseVoiceAvailable()` returns `true` after `getVoices()` resolves with a
  `zh-CN` voice.
- `isChineseVoiceAvailable()` returns `true` with a `zh-TW` voice (fallback).
- `isChineseVoiceAvailable()` returns `false` when only `en-US` voices are
  present.
- `speak('你好')` calls `speechSynthesis.speak()` with an utterance whose
  `text` is `'你好'` and `voice.lang` starts with `'zh'`.
- `speak('你好')` calls `speechSynthesis.cancel()` before
  `speechSynthesis.speak()` so new words replace current or queued utterances.
- `stop()` calls `speechSynthesis.cancel()`.
- State transitions: `idle` → `speak()` →
  `{ status: 'speaking', text: '你好' }` → `onend` → `idle`.
- State transitions: `speaking` → `stop()` → `idle`.
- `subscribeTts()` listeners are notified on voice availability and speech state
  changes, and unsubscribed listeners are not called.

### `tests/i18n.test.ts` (extend)

Assert the new `tts.speak` key exists in both `en` and `zh-CN`. The current
tests check selected labels rather than full key-set parity, so add explicit
assertions for this key.

### UI components

`SpeakButton` is thin glue over `lib/tts.ts` and follows the same pattern as
`PinyinButton` (untested UI component). No new component tests.

## Verification

Before claiming completion, run:

```bash
npm run compile   # tsc --noEmit — new module and components type-check
npm test          # full suite, including new tests/tts.test.ts
```

No manifest or background change is involved, so the build + manifest inspection
step from the general AGENTS.md guidance is not required for this feature.
