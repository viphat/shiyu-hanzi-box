# First-run Onboarding Carousel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show new (and upgrading) users a dismissible, localized carousel of the extension's core features the first time the dashboard opens, reopenable any time.

**Architecture:** A device-local `wxt/storage` boolean flag (`local:onboardingSeen`) drives a modal `OnboardingCarousel` rendered by the dashboard `App`. Slide data is a pure module reusing existing screenshots; a `useOnboarding` hook owns open/seen state; a Toolbar button reopens it manually.

**Tech Stack:** WXT, React 19, TypeScript, Tailwind CSS v4, Vitest + happy-dom, `wxt/testing/fake-browser`, lucide-react icons.

## Global Constraints

- **Locales:** every user-facing string goes through `t(locale, key)` / `formatMessage(locale, key, params)` from `lib/i18n.ts`; keys must exist in **both** `en` and `zh-CN` maps. `UiLocale = 'en' | 'zh-CN'`.
- **Message key type:** `MessageKey = keyof typeof messages.en` (defined in `lib/i18n.ts`). Adding a key means adding it to the `en` map (which extends the type) and the `zh-CN` map (runtime parity).
- **Storage:** device-local only via `storage.defineItem` (namespace `local:`). Do NOT add onboarding state to `AppSettings` (it must never be affected by backup/restore or folder-sync).
- **Image imports:** import PNGs from `@/assets/...` (the `@` alias resolves to project root, same as `@/lib/...`).
- **Theme tokens:** reuse existing watercolor tokens (`bg-card`, `bg-card-soft`, `bg-banner`, `border-border`, `border-border-soft`, `border-border-hover`, `text-ink`, `text-ink-secondary`, `text-muted`, `bg-accent`, `text-on-accent`, `bg-paper-input`). Do not introduce new color tokens.
- **Test style:** component/hook tests use `// @vitest-environment happy-dom`, `createRoot` + `act` from `react`/`react-dom/client`, and dispatch raw DOM events (no `@testing-library`). Storage tests import `fakeBrowser` from `wxt/testing/fake-browser` and call `fakeBrowser.reset()` in `beforeEach`.
- **Version:** ship as **v0.3.0** (`package.json` + `CHANGELOG.md`).

---

## File Structure

- Create: `lib/onboarding.ts` — storage flag + `getOnboardingSeen` / `markOnboardingSeen`.
- Create: `entrypoints/dashboard/components/onboarding/slides.ts` — pure slide data.
- Create: `entrypoints/dashboard/components/onboarding/OnboardingCarousel.tsx` — modal component.
- Create: `entrypoints/dashboard/hooks/useOnboarding.ts` — open/seen state hook.
- Modify: `lib/i18n.ts` — add `onboarding.*` and `toolbar.howItWorks` keys to `en` and `zh-CN`.
- Modify: `entrypoints/dashboard/components/Toolbar.tsx` — add `onHowItWorks` prop + button.
- Modify: `entrypoints/dashboard/App.tsx` — wire hook, render carousel, pass `onHowItWorks` to Toolbar.
- Modify: `package.json`, `CHANGELOG.md` — version bump + entry.
- Create tests: `tests/onboarding.test.ts`, `tests/onboarding-slides.test.ts`, `tests/onboarding-carousel.test.tsx`, `tests/use-onboarding.test.tsx`.

---

## Task 1: Onboarding storage flag

**Files:**
- Create: `lib/onboarding.ts`
- Test: `tests/onboarding.test.ts`

**Interfaces:**
- Consumes: `storage` from `wxt/utils/storage`.
- Produces:
  - `onboardingSeenStorage` — `WxtStorageItem<boolean, ...>` at key `local:onboardingSeen`, fallback `false`.
  - `getOnboardingSeen(): Promise<boolean>`
  - `markOnboardingSeen(): Promise<void>`

- [ ] **Step 1: Write the failing test**

```ts
// tests/onboarding.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getOnboardingSeen,
  markOnboardingSeen,
  onboardingSeenStorage,
} from '../lib/onboarding';

describe('onboarding storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to not-seen', async () => {
    expect(await getOnboardingSeen()).toBe(false);
  });

  it('marks onboarding as seen', async () => {
    await markOnboardingSeen();
    expect(await getOnboardingSeen()).toBe(true);
    expect(await onboardingSeenStorage.getValue()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboarding.test.ts`
Expected: FAIL — cannot resolve `../lib/onboarding`.

- [ ] **Step 3: Write minimal implementation**

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

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/onboarding.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add lib/onboarding.ts tests/onboarding.test.ts
git commit -m "feat(onboarding): add device-local seen flag"
```

---

## Task 2: i18n keys for onboarding

**Files:**
- Modify: `lib/i18n.ts` (add keys inside the `en` map ending at line ~211, and the `zh-CN` map ending at line ~419)

**Interfaces:**
- Produces (new `MessageKey`s, all plain strings except `onboarding.goToSlide` which takes `{n}`):
  `onboarding.welcome.title`, `onboarding.welcome.body`, `onboarding.capture.title`, `onboarding.capture.body`, `onboarding.word.title`, `onboarding.word.body`, `onboarding.quotes.title`, `onboarding.quotes.body`, `onboarding.review.title`, `onboarding.review.body`, `onboarding.export.title`, `onboarding.export.body`, `onboarding.skip`, `onboarding.back`, `onboarding.next`, `onboarding.getStarted`, `onboarding.close`, `onboarding.goToSlide`, `toolbar.howItWorks`.

- [ ] **Step 1: Add the keys to the `en` map**

Insert these entries just before the closing `},` of the `en` object (the line `211:  },`):

```ts
    'onboarding.welcome.title': 'Welcome to 拾语汉字box',
    'onboarding.welcome.body':
      'Collect Chinese words and sentences as you read, and turn them into a gentle daily review.',
    'onboarding.capture.title': 'Capture while reading',
    'onboarding.capture.body':
      'Select text on any page, then open the popup to save it as a word or a quote. You can also use the right-click menu or the shortcut (Ctrl / ⌘ + Shift + S).',
    'onboarding.word.title': 'Understand each word',
    'onboarding.word.body':
      'Every word gets pinyin, dictionary definitions, and an optional AI explanation with examples.',
    'onboarding.quotes.title': 'Turn quotes into practice',
    'onboarding.quotes.body':
      'Tag your quotes and add cloze blanks so you can actively recall them during review.',
    'onboarding.review.title': 'Review and track',
    'onboarding.review.body':
      'The dashboard schedules spaced-repetition reviews and shows your stats and streaks.',
    'onboarding.export.title': 'Export and sync',
    'onboarding.export.body':
      'Export your notes as daily Markdown, or back up and folder-sync your whole box.',
    'onboarding.skip': 'Skip',
    'onboarding.back': 'Back',
    'onboarding.next': 'Next',
    'onboarding.getStarted': 'Get started',
    'onboarding.close': 'Close',
    'onboarding.goToSlide': 'Go to slide {n}',
    'toolbar.howItWorks': 'How it works',
```

- [ ] **Step 2: Add the matching keys to the `zh-CN` map**

Insert these entries just before the closing `},` of the `zh-CN` object (the line `419:  },`):

```ts
    'onboarding.welcome.title': '欢迎使用拾语汉字box',
    'onboarding.welcome.body':
      '边阅读边收集中文词语与句子，把它们变成每日的轻松复习。',
    'onboarding.capture.title': '边读边收',
    'onboarding.capture.body':
      '在任意网页选中文字，打开弹窗即可保存为词语或句子。也可以使用右键菜单或快捷键（Ctrl / ⌘ + Shift + S）。',
    'onboarding.word.title': '看懂每个字',
    'onboarding.word.body':
      '每个词都会附上拼音、词典释义，以及可选的 AI 释义和例句。',
    'onboarding.quotes.title': '句子变练习',
    'onboarding.quotes.body':
      '为句子添加标签，并设置填空，让你在复习时主动回忆。',
    'onboarding.review.title': '复习与进度',
    'onboarding.review.body':
      '案头会安排间隔复习，并展示你的统计数据与连续天数。',
    'onboarding.export.title': '导出与同步',
    'onboarding.export.body':
      '把笔记导出为每日 Markdown，或备份并通过文件夹同步整个收藏箱。',
    'onboarding.skip': '跳过',
    'onboarding.back': '上一步',
    'onboarding.next': '下一步',
    'onboarding.getStarted': '开始使用',
    'onboarding.close': '关闭',
    'onboarding.goToSlide': '跳到第 {n} 页',
    'toolbar.howItWorks': '使用说明',
```

- [ ] **Step 3: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors (the new keys are now valid `MessageKey`s).

- [ ] **Step 4: Commit**

```bash
git add lib/i18n.ts
git commit -m "feat(onboarding): add en/zh-CN carousel strings"
```

---

## Task 3: Slide data module

**Files:**
- Create: `entrypoints/dashboard/components/onboarding/slides.ts`
- Test: `tests/onboarding-slides.test.ts`

**Interfaces:**
- Consumes: `MessageKey` from `@/lib/i18n`; PNGs from `@/assets/screenshots/*`; the keys added in Task 2.
- Produces:
  - `interface OnboardingSlide { titleKey: MessageKey; bodyKey: MessageKey; image?: string }`
  - `const ONBOARDING_SLIDES: OnboardingSlide[]` (length 6; slide 0 has no `image`).

- [ ] **Step 1: Write the failing test**

```ts
// tests/onboarding-slides.test.ts
import { describe, expect, it } from 'vitest';
import { ONBOARDING_SLIDES } from '../entrypoints/dashboard/components/onboarding/slides';
import { messages } from '../lib/i18n';

describe('onboarding slides', () => {
  it('has six slides with the first as an illustration (no image)', () => {
    expect(ONBOARDING_SLIDES).toHaveLength(6);
    expect(ONBOARDING_SLIDES[0].image).toBeUndefined();
    expect(ONBOARDING_SLIDES.slice(1).every((s) => typeof s.image === 'string')).toBe(true);
  });

  it('uses keys present in both en and zh-CN', () => {
    for (const slide of ONBOARDING_SLIDES) {
      for (const key of [slide.titleKey, slide.bodyKey]) {
        expect(messages.en[key]).toBeTruthy();
        expect(messages['zh-CN'][key as keyof typeof messages['zh-CN']]).toBeTruthy();
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboarding-slides.test.ts`
Expected: FAIL — cannot resolve the `slides` module.

- [ ] **Step 3: Write minimal implementation**

```ts
// entrypoints/dashboard/components/onboarding/slides.ts
import screenshotCapture from '@/assets/screenshots/screenshot-4.png';
import screenshotWord from '@/assets/screenshots/screenshot-2.png';
import screenshotCloze from '@/assets/screenshots/screenshot-3.png';
import screenshotDashboard from '@/assets/screenshots/screenshot-1.png';
import type { MessageKey } from '@/lib/i18n';

export interface OnboardingSlide {
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** Screenshot URL; omitted for the intro illustration slide. */
  image?: string;
}

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  { titleKey: 'onboarding.welcome.title', bodyKey: 'onboarding.welcome.body' },
  { titleKey: 'onboarding.capture.title', bodyKey: 'onboarding.capture.body', image: screenshotCapture },
  { titleKey: 'onboarding.word.title', bodyKey: 'onboarding.word.body', image: screenshotWord },
  { titleKey: 'onboarding.quotes.title', bodyKey: 'onboarding.quotes.body', image: screenshotCloze },
  { titleKey: 'onboarding.review.title', bodyKey: 'onboarding.review.body', image: screenshotDashboard },
  { titleKey: 'onboarding.export.title', bodyKey: 'onboarding.export.body', image: screenshotDashboard },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/onboarding-slides.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/components/onboarding/slides.ts tests/onboarding-slides.test.ts
git commit -m "feat(onboarding): add slide data"
```

---

## Task 4: OnboardingCarousel component

**Files:**
- Create: `entrypoints/dashboard/components/onboarding/OnboardingCarousel.tsx`
- Test: `tests/onboarding-carousel.test.tsx`

**Interfaces:**
- Consumes: `ONBOARDING_SLIDES` (Task 3); `t` / `formatMessage` from `@/lib/i18n`; `UiLocale` from `@/lib/types`; `Sprig` from `@/components/Foliage`; `iconUrl` from `@/assets/icon.png`; `X` from `lucide-react`.
- Produces: `function OnboardingCarousel({ locale, onClose }: { locale: UiLocale; onClose: () => void })`.
  - Renders slide `index` (0-based), starting at 0.
  - Primary button reads `next` on non-last slides and `getStarted` on the last; on the last slide it calls `onClose`.
  - `Skip` (slide 0) / `Back` (later slides) secondary button; X button; backdrop click; `Escape` — all call `onClose`. `ArrowLeft`/`ArrowRight` navigate. `Tab` is trapped within the dialog.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/onboarding-carousel.test.tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OnboardingCarousel } from '../entrypoints/dashboard/components/onboarding/OnboardingCarousel';
import { ONBOARDING_SLIDES } from '../entrypoints/dashboard/components/onboarding/slides';
import { t } from '../lib/i18n';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(node: ReactNode) {
  await act(async () => root.render(node));
}

async function click(el: Element) {
  await act(async () => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}

async function pressKey(key: string) {
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })));
}

function buttonByText(text: string): HTMLButtonElement | null {
  return ([...container.querySelectorAll('button')].find((b) => b.textContent?.trim() === text) ?? null) as HTMLButtonElement | null;
}

describe('OnboardingCarousel', () => {
  it('starts on the first slide', async () => {
    await render(<OnboardingCarousel locale="en" onClose={() => {}} />);
    expect(container.textContent).toContain(t('en', 'onboarding.welcome.title'));
    expect(buttonByText(t('en', 'onboarding.skip'))).not.toBeNull();
  });

  it('advances with Next and retreats with Back', async () => {
    await render(<OnboardingCarousel locale="en" onClose={() => {}} />);
    await click(buttonByText(t('en', 'onboarding.next'))!);
    expect(container.textContent).toContain(t('en', 'onboarding.capture.title'));
    await click(buttonByText(t('en', 'onboarding.back'))!);
    expect(container.textContent).toContain(t('en', 'onboarding.welcome.title'));
  });

  it('shows Get started on the last slide and calls onClose', async () => {
    const onClose = vi.fn();
    await render(<OnboardingCarousel locale="en" onClose={onClose} />);
    for (let i = 0; i < ONBOARDING_SLIDES.length - 1; i++) {
      await click(buttonByText(t('en', 'onboarding.next')) ?? buttonByText(t('en', 'onboarding.getStarted'))!);
    }
    const started = buttonByText(t('en', 'onboarding.getStarted'));
    expect(started).not.toBeNull();
    await click(started!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    await render(<OnboardingCarousel locale="en" onClose={onClose} />);
    await pressKey('Escape');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes when the backdrop is clicked but not when the dialog is clicked', async () => {
    const onClose = vi.fn();
    await render(<OnboardingCarousel locale="en" onClose={onClose} />);
    const dialog = container.querySelector('[role="dialog"]')!;
    await click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    const backdrop = dialog.parentElement!;
    await click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/onboarding-carousel.test.tsx`
Expected: FAIL — cannot resolve the `OnboardingCarousel` module.

- [ ] **Step 3: Write minimal implementation**

```tsx
// entrypoints/dashboard/components/onboarding/OnboardingCarousel.tsx
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import iconUrl from '@/assets/icon.png';
import { Sprig } from '@/components/Foliage';
import { formatMessage, t } from '@/lib/i18n';
import type { UiLocale } from '@/lib/types';
import { ONBOARDING_SLIDES } from './slides';

export function OnboardingCarousel({
  locale,
  onClose,
}: {
  locale: UiLocale;
  onClose: () => void;
}) {
  const slides = ONBOARDING_SLIDES;
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const slide = slides[index];
  const isLast = index === slides.length - 1;
  const titleId = 'onboarding-title';

  function next() {
    if (isLast) onClose();
    else setIndex((i) => Math.min(i + 1, slides.length - 1));
  }

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowRight') {
        setIndex((i) => Math.min(i + 1, slides.length - 1));
        return;
      }
      if (event.key === 'ArrowLeft') {
        setIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const nodes = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (nodes.length === 0) return;
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, slides.length]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(50,42,30,0.45)] p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-lg outline-none"
      >
        <button
          onClick={onClose}
          aria-label={t(locale, 'onboarding.close')}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted transition hover:bg-paper-input hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          {slide.image ? (
            <img
              src={slide.image}
              alt=""
              className="mb-5 w-full rounded-xl border border-border-soft"
            />
          ) : (
            <div className="relative mb-5 flex items-center justify-center rounded-xl border border-border-soft bg-banner py-10">
              <Sprig className="pointer-events-none absolute -right-1 -top-1 h-12 w-12 opacity-40" />
              <img src={iconUrl} alt="" className="h-16 w-16 rounded-2xl" />
            </div>
          )}
          <h2 id={titleId} className="text-lg font-bold text-ink tracking-[2px]">
            {t(locale, slide.titleKey)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {t(locale, slide.bodyKey)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-soft px-6 py-4">
          <div className="flex gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.titleKey}
                aria-label={formatMessage(locale, 'onboarding.goToSlide', { n: i + 1 })}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index ? 'w-5 bg-accent' : 'w-2 bg-border'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index === 0 ? (
              <button
                onClick={onClose}
                className="rounded-full px-3 py-1.5 text-sm text-muted transition hover:text-ink-secondary"
              >
                {t(locale, 'onboarding.skip')}
              </button>
            ) : (
              <button
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-ink-secondary transition hover:border-border-hover hover:bg-paper-input"
              >
                {t(locale, 'onboarding.back')}
              </button>
            )}
            <button
              onClick={next}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent shadow-sm transition hover:brightness-95"
            >
              {isLast ? t(locale, 'onboarding.getStarted') : t(locale, 'onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/onboarding-carousel.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/components/onboarding/OnboardingCarousel.tsx tests/onboarding-carousel.test.tsx
git commit -m "feat(onboarding): add carousel modal component"
```

---

## Task 5: useOnboarding hook

**Files:**
- Create: `entrypoints/dashboard/hooks/useOnboarding.ts`
- Test: `tests/use-onboarding.test.tsx`

**Interfaces:**
- Consumes: `getOnboardingSeen`, `markOnboardingSeen` (Task 1).
- Produces: `function useOnboarding(): { open: boolean; close: () => void; openManually: () => void }`.
  - On mount: reads the flag; if not seen, sets `open = true`.
  - `close()`: sets `open = false` and marks seen.
  - `openManually()`: sets `open = true` without touching the flag.

- [ ] **Step 1: Write the failing test**

```tsx
// tests/use-onboarding.test.tsx
// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { useOnboarding } from '../entrypoints/dashboard/hooks/useOnboarding';
import { getOnboardingSeen, markOnboardingSeen } from '../lib/onboarding';

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const { open, close, openManually } = useOnboarding();
  return (
    <div>
      <span data-testid="open">{String(open)}</span>
      <button data-testid="close" onClick={close}>close</button>
      <button data-testid="open-btn" onClick={openManually}>open</button>
    </div>
  );
}

beforeEach(() => {
  fakeBrowser.reset();
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

const openText = () => container.querySelector('[data-testid="open"]')!.textContent;
const clickTestId = async (id: string) =>
  act(async () =>
    container.querySelector(`[data-testid="${id}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );

describe('useOnboarding', () => {
  it('opens on mount when the flag is unseen', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {}); // flush the async flag read
    expect(openText()).toBe('true');
  });

  it('stays closed on mount when already seen', async () => {
    await markOnboardingSeen();
    await act(async () => root.render(<Harness />));
    await act(async () => {});
    expect(openText()).toBe('false');
  });

  it('close() marks seen and closes', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {});
    await clickTestId('close');
    expect(openText()).toBe('false');
    expect(await getOnboardingSeen()).toBe(true);
  });

  it('openManually() opens without marking seen', async () => {
    await markOnboardingSeen();
    await act(async () => root.render(<Harness />));
    await act(async () => {});
    await clickTestId('open-btn');
    expect(openText()).toBe('true');
    expect(await getOnboardingSeen()).toBe(true); // unchanged
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/use-onboarding.test.tsx`
Expected: FAIL — cannot resolve the `useOnboarding` module.

- [ ] **Step 3: Write minimal implementation**

```ts
// entrypoints/dashboard/hooks/useOnboarding.ts
import { useCallback, useEffect, useState } from 'react';
import { getOnboardingSeen, markOnboardingSeen } from '@/lib/onboarding';

export function useOnboarding() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    getOnboardingSeen().then((seen) => {
      if (mounted && !seen) setOpen(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    void markOnboardingSeen();
  }, []);

  const openManually = useCallback(() => {
    setOpen(true);
  }, []);

  return { open, close, openManually };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/use-onboarding.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/hooks/useOnboarding.ts tests/use-onboarding.test.tsx
git commit -m "feat(onboarding): add useOnboarding hook"
```

---

## Task 6: Wire into Toolbar and App

**Files:**
- Modify: `entrypoints/dashboard/components/Toolbar.tsx` (add prop + button)
- Modify: `entrypoints/dashboard/App.tsx` (use hook, render carousel, pass callback)

**Interfaces:**
- Consumes: `useOnboarding` (Task 5); `OnboardingCarousel` (Task 4); `toolbar.howItWorks` key (Task 2).
- Produces: `Toolbar` gains a required prop `onHowItWorks: () => void`.

- [ ] **Step 1: Add the `onHowItWorks` prop and button to Toolbar**

In `entrypoints/dashboard/components/Toolbar.tsx`, add `HelpCircle` to the lucide import on line 1:

```ts
import { Download, FileText, HelpCircle, Search, Settings, Upload } from 'lucide-react';
```

Add `onHowItWorks` to the destructured props and its type (extend the existing prop object, after `aiSettings`):

```tsx
export function Toolbar({
  inbox,
  query,
  onQuery,
  onRestore,
  locale,
  settings,
  aiSettings,
  onHowItWorks,
}: {
  inbox: Inbox;
  query: string;
  onQuery: (query: string) => void;
  onRestore: (restored: { inbox: Inbox; settings?: AppSettings; aiSettings?: AiSettings }) => Promise<void> | void;
  locale: UiLocale;
  settings: AppSettings;
  aiSettings: AiSettings;
  onHowItWorks: () => void;
}) {
```

Add the button immediately before the existing Settings button (the `<button onClick={openSettings} ...>` block near line 180):

```tsx
        <button
          onClick={onHowItWorks}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-transparent px-3 py-2.5 text-sm text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input"
        >
          <HelpCircle className="h-4 w-4" /> {t(locale, 'toolbar.howItWorks')}
        </button>
```

- [ ] **Step 2: Wire the hook and carousel into App**

In `entrypoints/dashboard/App.tsx`:

Add imports near the other local imports (after the `useSettings` import on line 36):

```tsx
import { useOnboarding } from './hooks/useOnboarding';
import { OnboardingCarousel } from './components/onboarding/OnboardingCarousel';
```

Inside `App`, after `const { settings, loading: settingsLoading } = useSettings();` (line 46), add:

```tsx
  const onboarding = useOnboarding();
```

Pass the callback to the existing `<Toolbar ... />` (add the prop alongside `aiSettings={aiSettings}` around line 363):

```tsx
          aiSettings={aiSettings}
          onHowItWorks={onboarding.openManually}
```

Render the carousel just inside the top-level wrapper — change the opening of the returned JSX (line 296-297) from:

```tsx
  return (
    <div className="min-h-screen text-ink">
```

to:

```tsx
  return (
    <div className="min-h-screen text-ink">
      {onboarding.open && (
        <OnboardingCarousel locale={locale} onClose={onboarding.close} />
      )}
```

- [ ] **Step 3: Typecheck and run the full suite**

Run: `npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass (existing + the 4 new onboarding test files).

- [ ] **Step 4: Build to confirm the extension bundles**

Run: `npm run build`
Expected: build completes without errors (asset imports resolve, no missing modules).

- [ ] **Step 5: Commit**

```bash
git add entrypoints/dashboard/components/Toolbar.tsx entrypoints/dashboard/App.tsx
git commit -m "feat(onboarding): show carousel on first dashboard open + How it works button"
```

---

## Task 7: Version bump and changelog

**Files:**
- Modify: `package.json` (line 5: `"version"`)
- Modify: `CHANGELOG.md`

**Interfaces:** none.

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.2.5"` to:

```json
  "version": "0.3.0",
```

- [ ] **Step 2: Add a changelog entry**

Read the top of `CHANGELOG.md` to match its existing heading format, then add a new section above the most recent entry:

```markdown
## 0.3.0

- Added a first-run onboarding carousel that introduces capture, word insight, quote practice, review, and export/sync. Reopen it any time from the "How it works" button on the dashboard.
```

- [ ] **Step 3: Verify the version is consistent**

Run: `node -p "require('./package.json').version"`
Expected: `0.3.0`

- [ ] **Step 4: Commit**

```bash
git add package.json CHANGELOG.md
git commit -m "chore: bump version to 0.3.0"
```

---

## Manual Verification (after Task 6, before release)

1. `npm run dev`, load the dev extension, open the dashboard in a fresh profile (or run `await onboardingSeenStorage.setValue(false)` via the dashboard console / clear extension storage) → the carousel appears automatically on the first slide.
2. Navigate with Next/Back, the dots, and ←/→ arrow keys; confirm each of the 6 slides shows the right image + caption.
3. Close via X, backdrop, Esc, Skip (slide 1), and "Get started" (slide 6) — each dismisses it; reopening the dashboard does NOT show it again.
4. Click **How it works** in the Toolbar → the carousel reopens; closing it again works.
5. Switch UI locale to `en` in Settings and repeat step 1–4 to confirm English copy renders.

---

## Self-Review Notes

- **Spec coverage:** trigger/persistence → Task 1 + Task 5; slide sequence/images → Task 3; carousel component + a11y + keyboard → Task 4; dashboard wiring + re-access button → Task 6; i18n keys → Task 2; testing → Tasks 1,3,4,5 tests + manual steps; version → Task 7. All spec sections mapped.
- **Type consistency:** `OnboardingSlide`/`ONBOARDING_SLIDES` names, `useOnboarding` return shape (`open`/`close`/`openManually`), and `onHowItWorks` prop are used identically across tasks. Message keys added in Task 2 are the exact keys referenced in Tasks 3/4/6.
- **No placeholders:** every code and copy step is concrete (full en/zh-CN strings, full component/test source).
