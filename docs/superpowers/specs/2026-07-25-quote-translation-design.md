# Quote Translation (Google + AI) — Design

Version target: `0.4.2`
Date: 2026-07-25

## Goal

Give every quote card two one-click ways to render the whole quote in English:

1. **Google** — the free, keyless `translate.googleapis.com` gtx endpoint.
2. **AI** — the existing BYO-key AI provider layer (`lib/ai/*`).

Both results persist on the quote, coexist so the user can compare machine
phrasing against AI phrasing, and reach the daily Markdown export.

## Non-Goals

- No translate buttons on word cards. The dictionary panel and AI insight
  already give English for single words.
- No translate buttons in the review screen. Review stays a recall flow.
- No official Google Cloud Translation API path and no translation-specific
  API key. The keyless endpoint is the whole point of the Google button.
- No automatic or batch translation. Every network call is one explicit click.
- No change to capture, dedupe, normalization, or SRS scheduling.

## Constraint To Acknowledge

There is no free *official* Google Translate API. `translate_a/single` with
`client=gtx` is undocumented and unsupported by Google. It works today and
needs no key, but it can rate-limit or change response shape without notice.
The design therefore treats every Google failure as an ordinary, localized,
retryable error state — never a crash, never a partial write.

## Data Model

`lib/types.ts` gains three types and one optional field on `QuoteEntry`. This
follows the `traditionalText` precedent: generated only on an explicit click,
then persisted.

```ts
export interface QuoteTranslation {
  text: string;
  generatedAt: number;
}

export interface AiQuoteTranslation extends QuoteTranslation {
  provider: AiProvider;
  model: string;
  baseUrl: string;
}

export interface QuoteTranslations {
  google?: QuoteTranslation;
  ai?: AiQuoteTranslation;
}
```

```ts
export interface QuoteEntry extends EntryBase {
  // ...existing fields
  translations?: QuoteTranslations;
}
```

The AI slot carries provenance the way `AiInsight` does; the Google slot has no
provenance to carry.

Source text is always `quote.text` — Simplified. Never `traditionalText`.
Traditional stays a pure display annotation, per existing convention.

Each slot is written independently. Clicking one button never clears or
overwrites the other slot. Re-clicking a button regenerates only its own slot.

## Modules

### `lib/translate/types.ts`

```ts
export type TranslateFailure =
  | 'rate-limited'
  | 'unreachable'
  | 'unexpected'
  | 'permission-denied'
  | 'empty'
  | 'not-configured';

export type TranslateResult =
  | { ok: true; text: string }
  | { ok: false; code: TranslateFailure; detail?: string };
```

Failures are returned as codes rather than English prose so the UI can localize
them. `detail` optionally carries the provider's own message on the AI path,
which today returns free text — the component appends it after the localized
line so provider errors stay debuggable.

### `lib/translate/google-parse.ts` (pure)

`parseGtxResponse(json: unknown): TranslateResult`

The gtx response is a nested array whose element `[0]` holds **one entry per
sentence segment**, each segment's translated text at `[0]`. A long quote comes
back split across several segments, so the parser must concatenate every
segment's text in order. This is the single most breakage-prone piece of the
feature and the reason it is isolated as a pure function.

Rules:

- Not an array, or `[0]` not an array → `{ ok: false, code: 'unexpected' }`.
- Segments present but every segment text is empty or non-string →
  `{ ok: false, code: 'empty' }`.
- Otherwise join the string `[0]` of each segment, in order, and return it.
  Non-string segment heads are skipped rather than failing the whole parse.

### `lib/translate/google.ts`

`fetchGoogleTranslation({ text }): Promise<TranslateResult>`

One `GET` to:

```
https://translate.googleapis.com/translate_a/single?client=gtx&sl=zh-CN&tl=en&dt=t&q=<encodeURIComponent(text)>
```

Status classification, mirroring `lib/ai/client.ts`:

| Condition | Code |
| --- | --- |
| `429` | `rate-limited` |
| `>= 500` | `unreachable` |
| other non-2xx | `unexpected` |
| `fetch` throws | `unreachable` |
| body fails `parseGtxResponse` | that parser's code |

Blank or whitespace-only input returns `{ ok: false, code: 'empty' }` without a
network call.

### `lib/translate/permissions.ts`

`requestGoogleTranslatePermission(): Promise<boolean>` — lazy
`browser.permissions.request({ origins: ['https://translate.googleapis.com/*'] })`,
wrapped in try/catch returning `false`, matching `lib/ai/permissions.ts`.

The **hook** calls this before `fetchGoogleTranslation`, exactly as
`useClozeSuggestions` calls `requestAiSettingsPermission` before its fetch.
`lib/translate/google.ts` stays a pure transport with no permission awareness,
which keeps it testable with nothing but a mocked `fetch`. A denial never
reaches the network; the hook sets the slot to `error` with code
`permission-denied`.

### `lib/ai/translate-prompt.ts` (pure)

`buildTranslateMessages(quoteText: string): AiMessage[]`

A system message instructing: translate the Chinese sentence into natural
English; return JSON only, shaped `{"translation": "..."}`; no commentary, no
pinyin, no explanation. A user message carrying the quote text.

### `lib/ai/translate-parse.ts` (pure)

`parseTranslation(content: string): TranslateResult`

`JSON.parse`, require a non-empty string `translation`, trim it. Invalid JSON,
wrong shape, or an empty/whitespace string → `{ ok: false, code: 'unexpected' }`.

### `lib/ai/client.ts` (edit)

```ts
fetchAiTranslation(params: {
  baseUrl: string;
  apiKey: string;
  model: string;
  provider: AiProvider;
  quoteText: string;
}): Promise<TranslateResult>
```

Reuses the existing private `postChatCompletion` with `maxTokens: 400`, then
`parseTranslation`. Non-ok HTTP results map to `unreachable` for 5xx and network
failures and `unexpected` otherwise, carrying the existing prose reason as
`detail`. Returning the shared `TranslateResult` is what lets the hook and the
component treat both paths identically.

### `entrypoints/dashboard/hooks/useQuoteTranslation.ts`

Owns both request paths and the persistence write for one quote.

Exposes per-slot state:

```ts
type SlotState = 'idle' | 'loading' | 'error' | 'disabled';

{
  google: { state: SlotState; failure?: TranslateFailure; detail?: string };
  ai:     { state: SlotState; failure?: TranslateFailure; detail?: string };
  translateGoogle(): Promise<void>;
  translateAi(): Promise<void>;
}
```

On mount it reads AI settings once (like `useClozeSuggestions`) and sets the AI
slot to `disabled` with failure `not-configured` when `isAiConfigured` is false.
The Google slot is never `disabled` — it needs no configuration.

Persistence mirrors `useAiInsight`: read `inboxStorage.getValue()`, map the
matching quote to a new object with the one slot merged into `translations`, bump
`updatedAt`, and write through `requestSyncMutation('inbox', next)`. A failed
request writes nothing.

### `entrypoints/dashboard/components/TranslateButtons.tsx`

Renders the two footer chips. Per slot, mirroring `TraditionalButton`'s
two-mode shape:

| Situation | Rendering |
| --- | --- |
| no translation, slot idle | generate chip (`EN·G` / `EN·AI`) |
| slot loading | disabled chip, "Translating…" |
| slot error | chip becomes Retry; localized message renders inline |
| translation exists | chip becomes an active show/hide toggle |
| AI slot, AI unconfigured | disabled chip, "Configure AI in Settings" title |

## UI Placement

Both chips sit in the existing `QuoteCard` footer row beside 繁 and the source
link. No new layout container.

Results render under the quote text as labelled lines, styled like the existing
Traditional line (`mt-2 pl-5 text-sm`), Google first then AI, each prefixed with
a muted `EN (Google)` / `EN (AI)` label.

Generating a translation auto-shows its line. Visibility is local React state
(`showGoogle`, `showAi`) exactly like `showTraditional` — not persisted.

Error text renders below the footer row, one line per failing slot, so a Google
failure and an AI failure can display at once without either being hidden.

## Integration Surfaces

### Sync — `lib/sync/project.ts`

Add **two separate flat LWW registers** to `QuoteNode.fields`:

- `translationGoogle` — `quote.translations?.google ?? null`
- `translationAi` — `quote.translations?.ai ?? null`

`materializeInbox` reads both back and reassembles `translations`, omitting the
field entirely when both registers are null/absent so untranslated quotes keep
their current shape.

Storing both slots inside one object register would make a Google translate on
device A and an AI translate on device B conflict, silently losing one. Separate
registers let both survive the merge. `QuoteNode.fields` is already
`Record<string, Register<unknown>>` and the merge is field-generic, so no change
to `lib/sync/types.ts` or `lib/sync/merge.ts` is required.

### Markdown export — `lib/markdown.ts`

When a quote has translations, emit nested bullets after the note line, Google
first:

```
- [ ] > 天地不仁，以万物为{{c1::刍狗}}
  - #道家
  - EN (Google): Heaven and earth are not kind...
  - EN (AI): Nature shows no favour...
  - [source.com](https://source.com/page)
```

Text is escaped with the existing `esc` helper. Export is read-only and never
triggers a translation request.

### Backup — `lib/backup.ts`

No change. `hasEntryBase` deliberately skips optional fields added after format
v1, and `cloneJson` preserves unknown keys on round-trip, so `translations`
survives backup and restore for free. `BACKUP_FORMAT_VERSION` stays `2`. A
round-trip test pins this behavior so a future validation tightening cannot drop
the field unnoticed.

### Manifest — `wxt.config.ts`

Add `https://translate.googleapis.com/*` to `optional_host_permissions`. It is
requested on first Google-translate click, never at install time.

### Privacy — `PRIVACY.md`

Add to the Network Requests section: clicking the Google translate button sends
that quote's sentence text to `translate.googleapis.com`, that this is Google's
unofficial keyless translation endpoint, that no API key or account is involved,
and that no translation request occurs unless the button is clicked. Add the AI
translate button to the existing list of AI actions and what each sends. Update
the Permissions section to mention the optional Google Translate host access.
Bump the "Last updated" date.

### i18n — `lib/i18n.ts`

New keys, in both `en` and `zh-CN` (`tests/i18n-source.test.ts` enforces
parity):

| Key | en | zh-CN |
| --- | --- | --- |
| `translate.googleShort` | `EN·G` | `EN·G` |
| `translate.aiShort` | `EN·AI` | `EN·AI` |
| `translate.googleTitle` | Translate to English with Google | 用 Google 翻译成英文 |
| `translate.aiTitle` | Translate to English with AI | 用 AI 翻译成英文 |
| `translate.showGoogle` | Show Google translation | 显示 Google 译文 |
| `translate.hideGoogle` | Hide Google translation | 隐藏 Google 译文 |
| `translate.showAi` | Show AI translation | 显示 AI 译文 |
| `translate.hideAi` | Hide AI translation | 隐藏 AI 译文 |
| `translate.labelGoogle` | EN (Google) | EN（Google） |
| `translate.labelAi` | EN (AI) | EN（AI） |
| `translate.loading` | Translating... | 翻译中... |
| `translate.retry` | Retry | 重试 |
| `translate.errRateLimited` | Google rate-limited this request; try again later. | Google 请求频率受限，请稍后重试。 |
| `translate.errUnreachable` | Translation service unreachable; retry. | 翻译服务无法访问，请重试。 |
| `translate.errUnexpected` | Unexpected translation response. | 翻译响应异常。 |
| `translate.errPermissionDenied` | Google Translate permission was not granted. | 未授予 Google 翻译权限。 |
| `translate.errEmpty` | Nothing to translate. | 没有可翻译的内容。 |
| `translate.errNotConfigured` | Configure AI in Settings to translate. | 请在设置中配置 AI 后再翻译。 |

The component maps a `TranslateFailure` code to its `translate.err*` key.

## Error Handling Summary

- Every failure is localized, inline, and retryable. Nothing throws to the user.
- A failed request writes nothing to storage; the previous slot value survives.
- The two slots fail independently.
- Blank input short-circuits before any network call.
- Permission denial is a distinct, actionable message.

## Testing

TDD per repo convention: pure modules first, then clients with mocked `fetch`,
then components, then integration surfaces.

New test files:

- `tests/translate-google-parse.test.ts` — single segment; multi-segment join
  order; non-array input; `[0]` not an array; all-empty segments; non-string
  segment head skipped.
- `tests/translate-google.test.ts` — URL construction and encoding; `429`;
  `500`; other non-2xx; `fetch` rejection; blank input short-circuits with no
  fetch; happy path.
- `tests/ai-translate-prompt.test.ts` — messages shape, quote text present,
  JSON-only instruction present.
- `tests/ai-translate-parse.test.ts` — valid; invalid JSON; missing key; wrong
  type; empty string; whitespace trimmed.
- `tests/ai-translate-client.test.ts` — happy path; HTTP error maps to a code
  and carries `detail`; parse failure maps to `unexpected`.
- `tests/quote-translation.test.tsx` — `TranslateButtons` renders each state;
  AI chip disabled when AI unconfigured; error shows Retry; toggle shows and
  hides; `QuoteCard` renders both labelled lines; generating one slot leaves the
  other intact.

Extended test files:

- `tests/markdown.test.ts` — Google-only, AI-only, both, neither; escaping.
- `tests/backup.test.ts` — `translations` survives a backup/restore round-trip.
- `tests/sync/project.test.ts` — both slots round-trip through project and
  materialize; a quote with no translations materializes without the field; and
  the two-device merge case: Google set on replica A, AI set on replica B, both
  present after merge.

Verification before completion:

```bash
npm run compile
npm test
npm run build
```

The build check matters because `optional_host_permissions` changes the
manifest; confirm `translate.googleapis.com` appears in
`.output/chrome-mv3/manifest.json`.

## Release

- `package.json` version → `0.4.2`.
- `CHANGELOG.md` entry describing both buttons, the persisted field, the export
  bullets, and the new optional host permission.
- `AGENTS.md` — add a numbered architecture note for `lib/translate/*` and the
  quote translation flow, add the new modules to the Core modules list, add the
  new focused test commands, and note the new convention: translations are a
  display/export annotation only, never used for capture, dedupe, normalization,
  or SRS scheduling.

## Out Of Scope (noted, not fixed)

`materializeInbox` in `lib/sync/project.ts` rebuilds quotes without `clozes`,
so quote blanks appear to be dropped through a sync round-trip. This is
pre-existing and unrelated to translation. It is deliberately left untouched
here and should be investigated separately.
