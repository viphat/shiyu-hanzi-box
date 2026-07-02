# Watercolor UI Redesign — Design Spec

**Date:** 2026-07-02
**Status:** Approved (brainstorming complete; implementation pending)
**Scope:** Purely presentational. No behavior, data, or logic changes anywhere.

## Goal

Replace the current "scholarly ink & cinnabar" visual language (sharp 2px corners,
paper-grid texture, cinnabar red accents) with a **cozy watercolor reading journal**
aesthetic, inspired by a mobile book-community app: warm cream palette, sage-green
accents, large rounded corners, soft cards, a greeting hero banner, and hand-drawn
watercolor-style foliage decoration.

All four UI surfaces are in scope:

1. Dashboard (main tab page) — `entrypoints/dashboard/`
2. Popup (toolbar capture) — `entrypoints/popup/`
3. Settings page — `entrypoints/settings/`
4. In-page capture toast — `lib/capture-toast.ts` (shadow DOM, inline styles)

## Approach (decided)

**Token-first retheme + targeted layout upgrades.** Rebuild the design tokens in
`styles.css`, rename `cinnabar-*` classes to semantic `accent-*` across components,
then make targeted layout changes where the aesthetic's character lives (hero banner,
pill tabs, card treatment). Rejected alternatives: full screen-by-screen redesign
(too much regression risk; mobile patterns like bottom tab bars don't fit a desktop
dashboard) and minimal token swap (misses the hero/pills that carry the charm).

## 1. Design tokens (`styles.css` `@theme`)

### Palette

| Token | Value | Role |
|---|---|---|
| `--color-paper` | `#f4eee1` | Page background (warm cream) |
| `--color-card` | `#fdfbf4` | Card surface (near-white cream) |
| `--color-card-soft` | `#fbf7ec` | Secondary card / toolbar surface |
| `--color-banner` | `#f9f3e4` | Hero banner surface |
| `--color-ink` | `#40392f` | Primary text (warm dark brown) |
| `--color-ink-secondary` | `#5c5442` | Body/secondary text |
| `--color-muted` | `#8b8068` | Muted labels |
| `--color-faint` | `#9a8f76` | Faintest metadata text |
| `--color-border` | `#e8dfca` | Hairline warm border |
| `--color-border-soft` | `#e6dcc6` | Banner border |
| `--color-chip` | `#f4eddb` | Inactive pill/chip fill (border `#e3d8bd`) |
| `--color-accent` | `#7d9070` | **Sage green primary accent** (replaces cinnabar) |
| `--color-accent-deep` | `#54704a` | Accent text on tinted fills |
| `--color-accent-strong` | `#5d7752` | Emphasized numbers/links |
| `--color-accent-tint` | `#eef2e6` | Pale sage fill (badges, tags) |
| `--color-accent-wash` | `#dfe7d4` | Sage watercolor wash (avatars, blobs) |
| `--color-peach` | `#f3e0c8` | Secondary warm tint (quote touches) |
| `--color-peach-deep` | `#8f6b3d` | Text on peach fills |
| `--on-accent` | `#f7f5ec` | Text on solid sage fills |

Keep functional colors (danger/success) if any exist; map them to warm-toned
equivalents rather than pure red/green.

### Shape, depth, type

- **Radius scale:** cards `18px`, banner `18px`, inner stat chips `14px`,
  inputs/controls `12–14px`, tags/chips/pills `999px`. Replace the current
  all-2px radius tokens.
- **Shadows:** very soft and low, e.g. `0 1px 3px rgba(90, 75, 50, 0.06)`;
  no hard borders-as-shadows.
- **Typography:** keep the Songti serif stack
  (`"Songti SC", "Source Han Serif SC", "Noto Serif CJK SC", "SimSun", "STSong", serif`).
  Relax global letter-spacing from `1px` to something gentler (`0.3–0.5px` body;
  headings may keep wider tracking).
- **Body background:** flat cream `--color-paper` with 1–2 very soft radial
  warm washes. The grid-paper repeating-linear-gradient texture is removed.
- **Selection color:** sage tint instead of cinnabar.

### Token rename

Rename `cinnabar-*` utility usages to `accent-*` (mechanical find/replace across
~20 files in `entrypoints/`). The `@theme` block defines only the new semantic
names; no `cinnabar` tokens remain.

## 2. Foliage decoration (`Foliage.tsx`)

A single shared React component file exporting small inline-SVG botanical
ornaments (hand-drawn watercolor style: thin branch strokes + rotated ellipse
leaves in 2–3 tints). No image assets; ~2–3 KB total; crisp at any zoom.

- **Palette:** sage leaves `#b9c7a3` / `#cdd8b9` on stems `#a8b894`/`#9db287`;
  autumn variant `#d9c39a` / `#e7d7b6` / `#f0d9b5` on stems `#c2a173`.
- **Placement (dashboard):** sage branch reaching in from page top-left; warm
  autumn branch from bottom-right; 1–2 tiny sprigs along margins. Hero banner
  gets denser greenery bottom-left and golden leaves top-right.
- **Rules:** low opacity (0.35–0.55), `aria-hidden="true"`,
  `pointer-events: none`, positioned behind content, static (no animation),
  hidden/faded on narrow viewports so content never collides.
- Settings and popup reuse the same component at smaller sizes.

## 3. Dashboard (`entrypoints/dashboard/`)

### Hero greeting banner (replaces current header)

- Time-of-day greeting via existing i18n (`t(locale, …)`), new keys for both
  locales: morning 5:00–11:00 (早安), afternoon 11:00–18:00 (午安), evening
  18:00–5:00 (晚安), plus a friendly one-line sub-message per period
  (e.g. 晨光刚好，捡一个词回来？) and the localized date.
- Extension icon as "mascot" in a rounded-16px tile on the right.
- The four stat cards (今日复习 / 收件箱 / 已复习 / 已归档) fold into the banner
  as a row of soft `#fdfaf2` rounded-14px chips; the review count uses
  `--color-accent-strong`.
- Banner surface `--color-banner`, hairline `--color-border-soft`, corner
  foliage per §2. SyncStatusBadge stays in the banner, restyled as a pill.

### Tabs, search, filters

- 复习/生词/摘录 tabs become a **pill segmented control**: active = solid sage
  pill with `--on-accent` text; inactive = `--color-chip` fill with hairline
  border. Counts stay in the labels.
- Search input becomes a full pill with a search icon; status filter `<select>`
  gets matching rounded treatment.
- Tabs + search live in a soft container card (`--color-card-soft`).
- The bamboo `◇ ◇ ◇` divider is **removed**; spacing provides the rhythm.

### Cards (WordCard, QuoteCard, ReviewQueue, TagCloud, SrsStatsPanel)

- Card surface `--color-card`, radius 18px, hairline `--color-border`, soft shadow.
- Words get a round sage-wash avatar (词); quotes a round peach-wash avatar (摘).
- Status badges and tags become pills: `--color-accent-tint` fill with
  `--color-accent-deep` text (peach variants where quote-flavored).
- Action icon rows use `--color-faint`, hover to `--color-accent-deep`.
- SrsStatsPanel restyled as the same soft rounded chip row style as the banner
  stats.
- Review enter/exit animations unchanged; `prefers-reduced-motion` behavior
  unchanged.

## 4. Popup (`entrypoints/popup/`)

- Inherits tokens via shared `styles.css`.
- Rounded card sections; 收生词 / 收摘录 as pill buttons (primary = solid sage).
- Manual-capture textarea gets the rounded-14px input treatment.
- One small corner leaf sprig from `Foliage.tsx`. **No greeting banner** — the
  popup stays a compact quick-action surface.

## 5. Settings (`entrypoints/settings/`)

- Structural layout unchanged; inherits the retheme through tokens: rounded
  cream cards, sage accents, pill buttons.
- Section headers drop the cinnabar underline accent (`.cinnabar-header-accent`)
  in favor of simple spacing (optionally a small sage leaf glyph).

## 6. Capture toast (`lib/capture-toast.ts`)

Inline shadow-DOM styles updated to the new palette:

- Card `#fdfbf4`, border `#e8dfca`, radius `14px`, text `#40392f`.
- Headline and Undo button: sage `#54704a` (replacing `#9c4221`); button hover
  fill `#eef2e6`.
- **No foliage** — must stay unobtrusive on arbitrary host pages.
- Keeps `system-ui` font (host-page context, not extension chrome).

## 7. Out of scope

- Dark mode (extension is light-only today; unchanged).
- New image/illustration assets (all decoration is inline SVG or CSS).
- Any behavior, data-model, sync, SRS, or i18n-logic changes beyond adding
  greeting strings.
- Layout restructuring of settings; mobile-app patterns (bottom tab bar).

## 8. Verification

- `npm run compile` and `npm test` stay green (no behavior changes expected;
  update any test that asserts on removed classes/markup like the bamboo divider).
- Manual pass: load the extension, eyeball all four surfaces (dashboard tabs ×
  review/words/quotes, popup capture + manual entry, settings, toast on a real
  page), check narrow-window behavior (foliage fades, no overlap).
- Greeting boundaries unit-testable if a helper like `greetingPeriod(hour)` is
  extracted (5→morning, 11→afternoon, 18→evening).

## Implementation order (suggested)

1. `styles.css` token rework + body background.
2. `cinnabar-*` → `accent-*` mechanical rename.
3. `Foliage.tsx` component.
4. Dashboard: hero banner → tabs/search pills → cards → stats.
5. Popup, settings, toast.
6. Verification pass.
