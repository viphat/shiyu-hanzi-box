# 素雅水墨 UI Theme — Design Spec

**Date:** 2026-06-20
**Scope:** Replace the current jade/ink Tailwind theme with a 素雅水墨 (ink wash)
style across the dashboard (newtab) and popup entrypoints.

## Goals

- Transform the visual identity to evoke traditional Chinese ink-wash aesthetics
- Maintain full functionality — no behavior changes, only CSS/styling
- Keep the codebase simple: no external image assets, no new dependencies
- Ensure dashboard and popup share a unified visual language

## Style Direction

**素雅水墨** (elegant ink wash): light paper-toned background, ink-dark text,
cinnabar red accents, Song/Serif CJK font stack, bamboo-style dividers. Clean and
readable for extended study sessions.

## Design Tokens

### Color Palette

All colors are defined in `styles.css` via `@theme` or CSS custom properties.

| Token | Value | Usage |
|-------|-------|-------|
| `--color-paper` | `#f5f0e8` | Page background |
| `--color-paper-light` | `rgba(255,252,245,0.5)` | Card, toolbar, stat bg |
| `--color-paper-input` | `rgba(255,252,245,0.8)` | Input field bg |
| `--color-ink` | `#1a1a1a` | Primary text, headings, large characters |
| `--color-ink-secondary` | `#4a3f35` | Secondary labels, toolbar text |
| `--color-muted` | `#8a7e6e` | Metadata, placeholders, inactive tab text |
| `--color-border` | `rgba(50,50,50,0.1)` | Card/section borders (default) |
| `--color-border-hover` | `rgba(50,50,50,0.2)` | Card borders on hover |
| `--color-border-strong` | `rgba(50,50,50,0.15)` | Header dividers, toolbar borders |
| `--color-cinnabar` | `#b4321e` | Primary buttons, accent underlines, tag tints |
| `--color-cinnabar-light` | `rgba(180,50,30,0.06)` | Tag bg |
| `--color-cinnabar-border` | `rgba(180,50,30,0.12)` | Tag borders |
| `--color-cinnabar-fade` | `rgba(180,50,30,0.5)` | Active tab underline, quote border |
| `--color-cinnabar-subtle` | `rgba(180,50,30,0.25)` | Toolbar label underline |

### Font Stack

```
--font-serif: "Songti SC", "Source Han Serif SC", "Noto Serif CJK SC",
              "SimSun", "STSong", serif;
```

- Replaces the current `--font-sans` as the global default
- Applied to `body` font-family
- Letter-spacing: 6px for main title, 2-3px for buttons/labels, 1px for body
- Numbers remain Arabic (not Chinese numerals)

### Border & Radius

- Global `border-radius: 2px` (replaces all `rounded-lg` / 8px)
- No rounded-pill shapes anywhere
- All borders use the ink/border color tokens above

## Background Texture (宣纸底纹)

Pure CSS implementation layered on the body/main wrapper:

1. **Fiber lines** — two `repeating-linear-gradient` layers (horizontal +
   vertical) at very low opacity (~0.05-0.08), 28-29px intervals, warm beige
   color `rgba(180,160,130,...)`
2. **Toning** — two `radial-gradient` layers for warm uneven shading,
   positioned off-center
3. **Base** — `linear-gradient(135deg, #f5f0e8, #ede6d8, #f2ece2, #e8e0d0)`

No external images or SVGs. All implemented in `styles.css`.

## Component Styles

### Header

- Logo: keep the existing `assets/icon.png` (current project icon), no changes
- Title: serif font, 26px, weight 700, color ink, letter-spacing 6px
- Subtitle: 12px, color muted, letter-spacing 2px
- Bottom divider: 2px solid border-strong, with a 50px-wide cinnabar-fade
  underline accent positioned at the left edge

### Stat Cards

- Grid of 4, same layout as current
- Background: paper-light, border: border
- Number: serif, 24px, weight 700, color ink
- Label: serif, 11px, color muted, letter-spacing 1px

### Toolbar (案头工具)

- Background: paper-light, border: border
- Label "案头工具": serif, cinnabar-subtle bottom border
- Search input: paper-input bg, border, serif font, muted placeholder
- Primary button (Export): cinnabar bg, white text, 2px radius,
  `letter-spacing: 2-3px`, subtle shadow
- Secondary buttons (备查/还原): transparent bg, ink-secondary text,
  border, 2px radius

### Tabs

- No pill/container background — just text items along a bottom border line
- Default: muted color, 13px, letter-spacing 2px
- Hover: slightly darker (ink-secondary)
- Active: ink color, weight 600, centered 36px cinnabar-fade underline
  (positioned via `::after` pseudo-element)

### Word Cards

- Background: paper-light, border: border, 2px radius
- Hover: border-hover + subtle shadow
- Hero character: serif, 32px, weight 700, color ink, letter-spacing 4px
- Metadata: 11px, color muted
- Tags: cinnabar-light bg, cinnabar-border, cinnabar-tinted text,
  letter-spacing 1px, 2px radius
- Action buttons: small seal-style (阅) and ink-style (档/删) buttons

### Quote Cards

- Same card shell as word cards
- Quote text: serif, 16px, line-height 2, color ink, letter-spacing 1px
- Left border: 3px solid cinnabar-fade
- Corner brackets: 「」 in cinnabar with 40% opacity, 20px size
- Source metadata: muted color below

### Bamboo Dividers

- Used between card groups or sections
- Centered text: `◇ ◇ ◇` or similar Unicode ornaments
- Color: border opacity (~0.15), 12px font-size, wide letter-spacing (12px)

### Empty States

- Container: paper-light bg with dashed border (border opacity)
- Large character: 56px, ink color at 12% opacity
- Title: serif, 16px, ink-secondary, letter-spacing 3px
- Subtitle: serif, 12px, muted

### Popup

- Same token system as dashboard
- Paper background (not white)
- Logo + serif title (18px, letter-spacing 4px) in header row
- Description: 11px, muted
- "Save as Word" button: cinnabar primary (seal style), full-width
- "Save as Quote" button: ink outline secondary, full-width
- Status text: 11px, muted, letter-spacing 1px

## Files to Change

| File | Change |
|------|--------|
| `styles.css` | Replace `@theme` block: new colors, font stack, add
  paper-texture to `body`. Remove jade/ink tokens. Add utility classes for
  bamboo dividers, cinnabar accents. |
| `entrypoints/newtab/App.tsx` | Update Tailwind classes: colors, radius,
  borders, font classes. Update `StatCard` styling. |
| `entrypoints/newtab/components/Toolbar.tsx` | Ink-wash toolbar styling,
  cinnabar label border, serif inputs. |
| `entrypoints/newtab/components/WordCard.tsx` | Card shell, serif hero
  character, cinnabar tags, seal/ink action buttons. |
| `entrypoints/newtab/components/QuoteCard.tsx` | Cinnabar left border,
  corner brackets, serif quote text. |
| `entrypoints/newtab/components/WordList.tsx` | Empty state styling
  (if inline). |
| `entrypoints/newtab/components/QuoteList.tsx` | Empty state styling
  (if inline). |
| `entrypoints/newtab/components/ReviewQueue.tsx` | Review card styling,
  empty state. |
| `entrypoints/newtab/components/PinyinButton.tsx` | Update colors to
  muted/cinnabar tokens. |
| `entrypoints/popup/Popup.tsx` | Full popup restyling to match
  dashboard tokens. |
| `entrypoints/popup/index.html` | Remove inline Tailwind bg/text
  classes that conflict with new theme. |

## What Does NOT Change

- No behavioral logic changes — all capture, storage, export flows unchanged
- No new npm dependencies
- No external image/SVG assets
- lucide-react icons are kept (they are neutral enough for ink-wash style)
- Icon colors inherit from text color tokens
- The existing `assets/icon.png` is kept as the logo

## Acceptance Criteria

1. Dashboard and popup render with ink-wash visual identity (paper bg, serif
   font, cinnabar accents, 2px radius)
2. All interactive features work identically (capture, search, filter, export,
   backup, restore, review)
3. `npm run compile` passes with no type errors
4. `npm run build` produces a valid Chrome MV3 extension
5. No visual regressions: all text is readable, buttons are clickable, cards
   expand/collapse, empty states display correctly
