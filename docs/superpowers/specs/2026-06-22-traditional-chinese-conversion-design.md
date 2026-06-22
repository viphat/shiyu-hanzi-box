# Traditional Chinese (Taiwan) Conversion Design

## Summary

Add a one-click Simplified → Traditional Chinese (Taiwan) conversion to Word and
Quote cards. Each card gains a small "繁" button that generates the Taiwan
Traditional form of the entry's text and persists it, plus a toggle to show or
hide the Traditional rendering beneath the Simplified heading.

The feature mirrors the existing `PinyinButton` pattern: a lazy, user-initiated
generator whose result is cached on the entry, with no impact on capture,
dedupe, identity, or export.

## Goals

- Let a reader convert any saved Word or Quote from Simplified Chinese to
  Taiwan-style Traditional Chinese with one click.
- Use Taiwan phrase-level conversion so regional terminology is respected
  (e.g. 软件 → 軟體, not 軟件).
- Persist the converted text on the entry so it is computed at most once and
  survives reloads, exactly like `pinyin`.
- Keep the show/hide control as lightweight, per-session component state.
- Keep the conversion logic in a pure, unit-testable module.
- Require no network request and no new permissions.

## Non-Goals

- Do not add Traditional → Simplified reverse conversion. The feature is
  one-directional, as the name states.
- Do not add Hong Kong (`hk`) variants. Only the Taiwan phrase config (`twp`)
  is in scope.
- Do not export Traditional text into the Markdown daily note or zip export.
  This is a card-display feature only.
- Do not add a bulk "convert all" action.
- Do not persist the show/hide toggle state across reloads. Only the converted
  `traditionalText` value is persisted; the user re-toggles to show it after a
  reload.
- Do not convert occurrence `surrounding` text. Only the entry's own `text`.
- Do not alter capture, normalize, dedupe, or review behavior. The Traditional
  form is a display annotation, never part of entry identity.

## Current Project Context

The extension already has a directly analogous feature in pinyin:

- `lib/pinyin.ts` wraps `pinyin-pro` for lazy, on-demand pinyin generation.
- `EntryBase` in `lib/types.ts` carries an optional `pinyin?: string` shared by
  both `WordEntry` and `QuoteEntry`.
- `entrypoints/newtab/components/PinyinButton.tsx` is the generator button: it
  shows a small "Pinyin" affordance; on click it calls `toPinyin(text)` and
  invokes `onGenerated(pinyin)` to persist; once `pinyin` exists on the entry,
  it renders as a static italic span instead of a button.
- `WordCard.tsx` places `PinyinButton` inside the header's
  `flex items-center gap-2` row, and the generated pinyin display sits in the
  metadata band.
- `QuoteCard.tsx` currently has no pinyin button but has an analogous metadata
  row (`mt-3 flex flex-wrap items-center gap-2`).

`pinyin-pro` is already a dependency but **does not perform Simplified/Traditional
character conversion**. Its `convert()` only transforms between pinyin *formats*
(number ↔ tone marks). Its `addTraditionalDict()` is a hook for callers to
supply their own character dictionary; it ships no S→T data. A dedicated
conversion library is therefore required.

## Conversion Engine

Use [`opencc-js`](https://github.com/nk2028/opencc-js) (MIT), the JavaScript
port of Open Chinese Convert.

- **Version**: `opencc-js@1.3.1`, `@types/opencc-js@1.0.3` (dev).
- **Config**: `from: 'cn'`, `to: 'twp'` — Simplified → Traditional (Taiwan) with
  phrase-level variant conversion. `twp` is preferred over plain `tw` because it
  applies regional term substitutions (软件 → 軟體, 自行車 → 腳踏車) in addition to
  character-level mapping and one-to-many disambiguation by context
  (头发 → 頭髮, 干杯 → 乾杯).
- **Bundle**: opencc-js bundles its dictionary data inside the package, so no
  runtime fetch is needed. To avoid pulling in the unused reverse
  (Traditional → Simplified) dictionaries, import via the preset split so the
  bundler can tree-shake:
  ```ts
  import * as OpenCC from 'opencc-js/core';
  import * as Locale from 'opencc-js/preset';
  ```
  This keeps the shipped footprint to the `cn → twp` dictionaries only.
- **No new permissions**: conversion is purely in-memory; no host permissions,
  `scripting`, or storage-permission changes are required.

## Architecture

### New module: `lib/traditional.ts`

A pure module that mirrors `lib/pinyin.ts`:

```ts
export function toTraditionalTaiwan(text: string): string;
```

- Builds the opencc-js `Converter` lazily on first call and memoizes it in
  module scope, so the dictionary initialization cost is paid once per dashboard
  session.
- The converter itself is synchronous once built, so the function is
  synchronous (like `toPinyin`).
- Returns the `twp` conversion of the input. Non-Chinese characters pass through
  unchanged (opencc-js behavior).
- Empty input returns empty output.

Unit-testable without any Chrome APIs, exactly like `lib/pinyin.ts`.

### Type change: `lib/types.ts`

Add an optional field to `EntryBase`:

```ts
interface EntryBase {
  // ...existing fields...
  pinyin?: string;
  traditionalText?: string; // NEW: cached Simplified→Traditional (Taiwan) form
  review?: ReviewState;
}
```

Because it lives on `EntryBase`, both `WordEntry` and `QuoteEntry` gain it
automatically. It is optional, so existing stored entries are unaffected.

### Data flow

1. User clicks the "繁" button on a Word or Quote card.
2. The card calls `toTraditionalTaiwan(entry.text)`.
3. The card calls `onUpdate({ traditionalText })`, persisting the value on the
   entry (mirrors `onUpdate({ pinyin })` exactly).
4. The card's local `useState` tracks whether the Traditional rendering is
   currently shown. When shown, it renders `entry.traditionalText` beneath the
   Simplified heading.

No changes to `lib/capture.ts`, `lib/normalize.ts`, `lib/storage.ts`,
`lib/markdown.ts`, `lib/export.ts`, or any `lib/ai/*` module. The Traditional
form is a display annotation only.

## UI & Interaction

### New component: `TraditionalButton.tsx`

One component handling both states, modeled on how `PinyinButton.tsx` renders
either a generator button or a static display from a single component:

- Props: `{ text, existing, onGenerated, shown, onToggle, locale }`.
  - `text`, `existing`, `onGenerated` mirror `PinyinButton`.
  - `shown` / `onToggle` drive the show/hide chip once `existing` is set. These
    are owned by the parent card (see below) because the Traditional text itself
    renders outside this component, in the card's metadata area.
- When `existing` (i.e. `entry.traditionalText`) is absent: renders a small
  button with a `Sparkles` icon and the localized label `traditional.generate`
  ("Traditional" / "繁體"). On click: calls `toTraditionalTaiwan(text)`, then
  `onGenerated(result)`.
- When `existing` is present: renders a small toggle chip labeled `繁`, styled
  like the existing badge buttons (`rounded-sm border border-border`, muted when
  `!shown`, `cinnabar` when `shown`). Clicking invokes `onToggle`. This mirrors
  how `PinyinButton` switches to a static display once pinyin exists.

Because the show/hide state lives in the card, it does not survive unmount
(e.g. collapsing the Word card) or reload. This is intentional and matches the
Non-Goal: only `traditionalText` is persisted; visibility is re-toggled per
session.

### `WordCard.tsx` changes

- Add `const [showTraditional, setShowTraditional] = useState(false);`.
- In the header's `flex items-center gap-2` row, place `TraditionalButton`
  immediately after `PinyinButton`, passing `text={word.text}`,
  `existing={word.traditionalText}`,
  `onGenerated={(t) => onUpdate({ traditionalText: t })}`,
  `shown={showTraditional}`, `onToggle={() => setShowTraditional((v) => !v)}`,
  and `locale`.
- In the metadata band (`mt-2 flex flex-wrap items-center gap-1.5 pl-7`), when
  `showTraditional && word.traditionalText`, render the Traditional text in the
  same secondary style as pinyin (`text-xs italic text-cinnabar`).

### `QuoteCard.tsx` changes

- Add `const [showTraditional, setShowTraditional] = useState(false);`.
- In the metadata row (`mt-3 flex flex-wrap items-center gap-2`), place
  `TraditionalButton` with the same props pattern (text/existing/onGenerated/
  shown/onToggle/locale).
- When `showTraditional && quote.traditionalText`, render the Traditional text
  beneath the blockquote, styled consistently with the card's muted text.

### i18n keys (`lib/i18n.ts`)

Add to both `en` and `zh-CN`:

| Key                    | en               | zh-CN   |
| ---------------------- | ---------------- | ------- |
| `traditional.generate` | `Traditional`    | `繁體`  |
| `traditional.show`     | `Show Traditional`| `显示繁體` |
| `traditional.hide`     | `Hide Traditional`| `隐藏繁體` |

The i18n parity test (`tests/i18n.test.ts`) must continue to pass, i.e. every
key exists in both locales.

## Testing

Follow the project's TDD conventions; the conversion logic is pure and
fully unit-testable.

### `tests/traditional.test.ts` (new)

Cover `toTraditionalTaiwan`:

- Basic Simplified → Traditional: `学习` → `學習`.
- Taiwan phrase variant (proves `twp`, not `tw`): `软件` → `軟體`.
- Taiwan-specific one-to-many disambiguation: `头发` → `頭髮`.
- Pass-through for non-Chinese: `"hello 123"` → `"hello 123"`.
- Empty string → empty string.
- Mixed CJK + ASCII: `Python语言` → `Python語言`.

### `tests/i18n.test.ts` (extend)

Assert the three new keys exist in both `en` and `zh-CN`. The existing parity
test pattern already enforces key-set equality, so adding the keys to both
locales is sufficient.

### UI components

`TraditionalButton` is thin glue over the pure module
and the existing `onUpdate` / `useState` patterns. They are not unit-tested,
consistent with how `PinyinButton` (also untested) is handled — only the
underlying pure module (`lib/pinyin.ts`) has tests.

## Verification

Before claiming completion, run:

```bash
npm run compile   # tsc --noEmit — new module, types field, and components type-check
npm test          # full suite, including new tests/traditional.test.ts
```

No manifest or background change is involved, so the build + manifest inspection
step from the general AGENTS.md guidance is not required for this feature.

## Open Questions

None. All decisions (interaction model, persistence, engine, scope) were
resolved during brainstorming.
