# First-run Onboarding Carousel — Design (v0.3.0)

**Date:** 2026-07-03
**Status:** Approved, ready for implementation plan

## Problem

New users (and users upgrading to v0.3.0) land on the dashboard with no guidance
on how the extension works. The most important interaction — capturing Chinese
words and quotes *while reading a page* — happens outside the dashboard (via the
popup, context menu, or keyboard shortcut), so it is not self-evident from the
dashboard alone. We want a lightweight, on-brand first-run walkthrough that
introduces the core loop and the main features.

## Goals

- Show a dismissible carousel of screenshots + captions the first time the
  dashboard is opened.
- Cover the core loop: capture while reading → understand words → practice
  quotes → review → export/sync.
- Reuse existing polished screenshots (no new image capture work).
- Let users reopen the walkthrough any time.
- Fully localized (`en` and `zh-CN`).

## Non-goals

- No interactive product tour / spotlight-on-real-UI tooltips.
- No new screenshots or illustration commissions.
- No dedicated `welcome.html` entrypoint (the carousel is a dashboard modal).
- No analytics/telemetry on slide views.

## Trigger & Persistence

A dedicated **device-local** storage flag, separate from `settings` so it is
never affected by backup/restore or folder-sync:

```ts
// lib/onboarding.ts
import { storage } from 'wxt/utils/storage';

export const onboardingSeenStorage = storage.defineItem<boolean>(
  'local:onboardingSeen',
  { fallback: false },
);

export async function getOnboardingSeen(): Promise<boolean> {
  return onboardingSeenStorage.getValue();
}

export async function markOnboardingSeen(): Promise<void> {
  await onboardingSeenStorage.setValue(true);
}
```

Behavior:

- On dashboard mount, if `onboardingSeen === false`, the carousel opens
  automatically as a modal overlay.
- Closing the carousel by **any** means — finishing the last slide
  ("Get started"), the X button, clicking the backdrop, or pressing Esc —
  marks it seen (`onboardingSeen = true`).
- There is **no separate "Don't show again" checkbox**; because it only
  auto-shows once, closing it *is* the acknowledgment.
- **Upgraders** to v0.3.0 have `onboardingSeen` default to `false`, so they see
  it once as well. This is intended — it introduces features they may not know.

## Slide Sequence

Six slides, all using existing images in `assets/screenshots/` (imported as
URLs the same way `iconUrl` is imported today).

| # | Title (en / zh-CN)            | Image                        | Caption focus |
|---|-------------------------------|------------------------------|---------------|
| 1 | Welcome / 欢迎                 | app icon + `Foliage` sprig (no screenshot) | What it is: capture Chinese words & quotes while reading |
| 2 | Capture while reading / 边读边收 | `screenshot-4.png` (popup)   | Select text on any page → open the popup → Save as word or quote. Also mention the context menu and keyboard shortcut. |
| 3 | Understand each word / 看懂每个字 | `screenshot-2.png`           | Pinyin, definitions, and Ask AI in the word insight panel |
| 4 | Turn quotes into practice / 句子变练习 | `screenshot-3.png`      | Tag quotes and add cloze blanks to review them |
| 5 | Review & track / 复习与进度      | `screenshot-1.png`           | Spaced-repetition review, stats, and streaks on the dashboard |
| 6 | Export & sync / 导出与同步       | `screenshot-1.png`           | Export daily Markdown; back up / folder-sync your box |

Notes:

- Slide 1 is a text/illustration slide (reuses `iconUrl` and a `Foliage` motif
  for cohesion with the watercolor theme) — no screenshot.
- Slides 2–6 render a bordered screenshot with a caption block beneath.
- Slide 6 reuses `screenshot-1.png` (which shows the toolbar export button)
  rather than adding a new image.
- All titles and captions go through `t(locale, key)` with new keys added to
  both `en` and `zh-CN` in `lib/i18n.ts`.

## Component Structure

```
entrypoints/dashboard/components/onboarding/
  OnboardingCarousel.tsx   // modal shell + navigation
  slides.ts                // slide data (pure, testable)
```

**`slides.ts`** — pure data, no React:

```ts
import screenshotCapture from '@/assets/screenshots/screenshot-4.png';
import screenshotWord from '@/assets/screenshots/screenshot-2.png';
import screenshotCloze from '@/assets/screenshots/screenshot-3.png';
import screenshotDashboard from '@/assets/screenshots/screenshot-1.png';
import type { MessageKey } from '@/lib/i18n';

export interface OnboardingSlide {
  titleKey: MessageKey;
  bodyKey: MessageKey;
  image?: string;      // undefined => illustration slide (slide 1)
}

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  { titleKey: 'onboarding.welcome.title',  bodyKey: 'onboarding.welcome.body' },
  { titleKey: 'onboarding.capture.title',  bodyKey: 'onboarding.capture.body',  image: screenshotCapture },
  { titleKey: 'onboarding.word.title',     bodyKey: 'onboarding.word.body',     image: screenshotWord },
  { titleKey: 'onboarding.quotes.title',   bodyKey: 'onboarding.quotes.body',   image: screenshotCloze },
  { titleKey: 'onboarding.review.title',   bodyKey: 'onboarding.review.body',   image: screenshotDashboard },
  { titleKey: 'onboarding.export.title',   bodyKey: 'onboarding.export.body',   image: screenshotDashboard },
];
```

**`OnboardingCarousel.tsx`** — modal shell. Props: `{ locale, onClose }`.

- Internal `index` state (0-based). Prev/Next buttons; Next on the last slide
  becomes "Get started" and calls `onClose`. A "Skip" text button and an X
  button both call `onClose`. Dot indicators reflect/allow jumping to a slide.
- Keyboard: `←` / `→` navigate; `Esc` calls `onClose`.
- Backdrop click calls `onClose`; clicks inside the dialog do not.
- Accessibility: `role="dialog"`, `aria-modal="true"`, `aria-labelledby` the
  active slide's title element; focus is trapped within the dialog while open;
  focus moves into the dialog on open.
- Styling uses existing watercolor theme tokens (`bg-card`, `bg-card-soft`,
  `border-border`, `text-ink`, `text-ink-secondary`, `bg-accent`,
  `text-on-accent`, etc.) to match the v0.2.5 redesign.

## Dashboard Wiring & Re-access

A small hook owns open/seen state:

```ts
// entrypoints/dashboard/hooks/useOnboarding.ts
// Returns { open, loading, openManually, close }
// - on mount: reads onboardingSeenStorage; if false, open = true
// - close(): sets open = false AND marks seen (idempotent)
// - openManually(): sets open = true WITHOUT touching the seen flag
```

- `App.tsx` uses the hook and renders `<OnboardingCarousel locale={locale}
  onClose={close} />` when `open` is true. The carousel must not render until
  both inbox/settings loading and the onboarding flag read have resolved, to
  avoid a flash.
- **Re-access:** a "How it works" (`使用说明`) button is added to the `Toolbar`
  (alongside the existing Settings/Export controls). It calls `openManually()`.

## i18n Keys

Add to both `en` and `zh-CN` maps in `lib/i18n.ts`:

- `onboarding.welcome.title`, `onboarding.welcome.body`
- `onboarding.capture.title`, `onboarding.capture.body`
- `onboarding.word.title`, `onboarding.word.body`
- `onboarding.quotes.title`, `onboarding.quotes.body`
- `onboarding.review.title`, `onboarding.review.body`
- `onboarding.export.title`, `onboarding.export.body`
- `onboarding.skip` ("Skip" / 跳过)
- `onboarding.next` ("Next" / 下一步)
- `onboarding.back` ("Back" / 上一步)
- `onboarding.getStarted` ("Get started" / 开始使用)
- `onboarding.close` (aria-label "Close" / 关闭)
- `toolbar.howItWorks` ("How it works" / 使用说明)

## Testing

- **`slides.ts`**: unit test asserts slide count (6) and that every `titleKey`
  and `bodyKey` exists in **both** locale maps (i18n completeness guard).
- **`OnboardingCarousel`** (happy-dom + vitest, existing test setup): renders
  the first slide; Next/Back advance and retreat; the last slide's primary
  button and the X/Skip/Esc paths each fire `onClose`; backdrop click fires
  `onClose` while an inner click does not.
- **`useOnboarding`** behavior: with a mocked `onboardingSeenStorage`, mount
  with `false` opens; `close()` marks seen and closes; `openManually()` opens
  without writing the flag.

## Version

Ship as **v0.3.0**. Bump `version` in `package.json` and add a `CHANGELOG.md`
entry.

## Out of Scope / Future

- Interactive spotlight tour on live UI.
- Per-feature contextual tips.
- Re-showing the walkthrough automatically when major new features ship
  (would need a versioned "last seen" value rather than a boolean).
