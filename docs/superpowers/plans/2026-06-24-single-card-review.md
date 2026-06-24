# Single-Card Review Experience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Review tab as one large card at a time, keeping word answers behind Reveal while showing quote content and rating controls immediately.

**Architecture:** Keep `buildSrsQueue` and the filtered queue in `App.tsx` as the only review-session source of truth. `ReviewQueue` renders only the first item, owns a short exit/enter transition around the existing async answer/postpone callbacks, and remounts `ReviewCard` by entry identity so word reveal state resets naturally. No new persisted session state or manual queue index is added.

**Tech Stack:** React 19, TypeScript, Tailwind CSS, WXT, Vitest, Happy DOM for interaction tests.

---

## File Structure

**Creates:**

- No production modules. The redesign stays within the existing review
  component boundary.

**Modifies:**

- `package.json` and `package-lock.json` — add `happy-dom` as a test-only DOM
  environment.
- `entrypoints/dashboard/components/ReviewQueue.tsx` — render one active card,
  split word/quote behavior, manage transition/busy state, and display the
  remaining count.
- `entrypoints/dashboard/App.tsx` — return the existing async inbox mutation
  promises from answer/postpone handlers.
- `styles.css` — define the quick review-card fade/slide animation and
  reduced-motion behavior.
- `lib/i18n.ts` — add the localized remaining-card label.
- `tests/review-queue.test.tsx` — replace list/reveal assumptions with static
  one-card coverage and add real interaction/advancement tests.
- `tests/i18n.test.ts` — cover the new remaining-card label.
- `README.md` — describe the focused one-card review experience and correct the
  old generic reveal wording.
- `AGENTS.md` — document the landed SRS architecture, review component rules,
  and focused tests.
- `PRIVACY.md` — clarify that recall ratings and generated schedules stay
  local.
- `docs/chrome-web-store.md` — quietly mention local spaced repetition in
  purpose/data notes.
- `docs/chrome-web-store-dashboard-checklist.md` — add one supporting feature
  bullet and reviewer-facing data disclosure language.
- `docs/chrome-web-store-reviewer-notes.md` — add a short single-card review
  smoke test and local review-data privacy note.

---

## Task 1: Add Localized Remaining-Card Copy

**Files:**

- Modify: `lib/i18n.ts`
- Modify: `tests/i18n.test.ts`

- [ ] **Step 1: Write the failing i18n test**

Append this test inside `describe('i18n messages', ...)` in
`tests/i18n.test.ts`:

```ts
  it('formats the remaining review-card count in both locales', () => {
    expect(formatMessage('en', 'review.remaining', { count: 12 })).toBe(
      '12 remaining',
    );
    expect(
      formatMessage('zh-CN', 'review.remaining', { count: 12 }),
    ).toBe('剩余 12 张');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/i18n.test.ts
```

Expected: FAIL because `review.remaining` is not a valid message key and falls
back to the key text.

- [ ] **Step 3: Add the message keys**

In `lib/i18n.ts`, add near the other English `review.*` keys:

```ts
    'review.remaining': '{count} remaining',
```

Add near the matching `zh-CN` keys:

```ts
    'review.remaining': '剩余 {count} 张',
```

- [ ] **Step 4: Run the test to verify it passes**

Run:

```bash
npx vitest run tests/i18n.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/i18n.ts tests/i18n.test.ts
git commit -m "feat(review): add localized remaining-card count"
```

---

## Task 2: Render One Large Card With Correct Word And Quote Behavior

**Files:**

- Modify: `entrypoints/dashboard/components/ReviewQueue.tsx`
- Modify: `tests/review-queue.test.tsx`

- [ ] **Step 1: Replace the static component tests with the new contract**

Keep the existing word/quote factories in `tests/review-queue.test.tsx`, but
replace the current `describe('ReviewQueue reveal-then-rate flow', ...)` block
with:

```tsx
describe('ReviewQueue single-card rendering', () => {
  it('renders only the first queue item and shows the remaining count', () => {
    const first = migrateReviewState(word({ id: 'w1', text: '你好' }), NOW);
    const second = migrateReviewState(
      word({ id: 'w2', text: '再见', normalized: '再见' }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[
          { kind: 'word', entry: first, dueAt: NOW },
          { kind: 'word', entry: second, dueAt: NOW },
        ]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );

    expect(html).toContain('你好');
    expect(html).not.toContain('再见');
    expect(html).toContain('2 remaining');
  });

  it('shows a word and Reveal while hiding insight and ratings', () => {
    const entry = migrateReviewState(
      word({ note: 'remember this note' }),
      NOW,
    );
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'word', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );

    expect(html).toContain('你好');
    expect(html).toContain(messages.en['review.reveal']);
    expect(html).toContain(messages.en['review.postpone']);
    expect(html).not.toContain('remember this note');
    expect(html).not.toContain(messages.en['review.again']);
    expect(html).not.toContain(messages.en['review.good']);
  });

  it('shows revealed word insight and ratings in the large card', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewCard
        item={{ kind: 'word', entry, dueAt: NOW }}
        remainingCount={1}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
        initiallyRevealed
      />,
    );

    expect(html).not.toContain(messages.en['review.reveal']);
    expect(html).toContain(messages.en['review.again']);
    expect(html).toContain(messages.en['review.hard']);
    expect(html).toContain(messages.en['review.good']);
    expect(html).toContain(messages.en['review.easy']);
  });

  it('shows quote content, note, and ratings immediately without Reveal', () => {
    const entry = migrateReviewState(quote(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'quote', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );

    expect(html).toContain('学而时习之');
    expect(html).toContain('a note');
    expect(html).toContain('Analects');
    expect(html).toContain(messages.en['review.again']);
    expect(html).toContain(messages.en['review.easy']);
    expect(html).not.toContain(messages.en['review.reveal']);
    expect(html).not.toContain(messages.en['review.revealTitle']);
  });

  it('uses the larger focused review-card layout', () => {
    const entry = migrateReviewState(word(), NOW);
    const html = renderToStaticMarkup(
      <ReviewQueue
        items={[{ kind: 'word', entry, dueAt: NOW }]}
        onAnswer={vi.fn()}
        onPostpone={vi.fn()}
        locale="en"
      />,
    );

    expect(html).toContain('min-h-[420px]');
    expect(html).toContain('max-w-4xl');
  });
});
```

Update the callback props in the test file to accept async-compatible callbacks:

```ts
onAnswer={vi.fn().mockResolvedValue(undefined)}
onPostpone={vi.fn().mockResolvedValue(undefined)}
```

Static rendering also accepts plain `vi.fn()`, but using resolved promises
documents the production contract introduced in Task 3.

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
npx vitest run tests/review-queue.test.tsx
```

Expected failures:

- the second item is still rendered;
- no remaining-count label exists;
- quote content is still coupled to reveal state;
- `ReviewCard` does not accept `remainingCount`;
- the large layout classes are absent.

- [ ] **Step 3: Restructure `ReviewQueue` around the first item**

In `entrypoints/dashboard/components/ReviewQueue.tsx`, update the imports:

```tsx
import {
  Eye,
  MessageSquareQuote,
  RotateCw,
  WholeWord,
} from 'lucide-react';
import { useState } from 'react';
import { formatMessage, t } from '@/lib/i18n';
import type { SrsQueueItem } from '@/lib/srs';
import type { Entry, ReviewRating, UiLocale } from '@/lib/types';
import { ReviewInsightReveal } from './ReviewInsightReveal';
```

Replace the non-empty return in `ReviewQueue` with a focused child component:

```tsx
  return (
    <ActiveReviewCard
      items={items}
      onAnswer={onAnswer}
      onPostpone={onPostpone}
      locale={locale}
    />
  );
```

For this task, retain callback types as `void | Promise<void>` so Task 3 can
await them without another public signature change:

```tsx
  onAnswer: (
    kind: Entry['kind'],
    id: string,
    rating: ReviewRating,
  ) => void | Promise<void>;
  onPostpone: (
    kind: Entry['kind'],
    id: string,
  ) => void | Promise<void>;
```

Add this component below `ReviewQueue`:

```tsx
function ActiveReviewCard({
  items,
  onAnswer,
  onPostpone,
  locale,
}: {
  items: SrsQueueItem[];
  onAnswer: (
    kind: Entry['kind'],
    id: string,
    rating: ReviewRating,
  ) => void | Promise<void>;
  onPostpone: (
    kind: Entry['kind'],
    id: string,
  ) => void | Promise<void>;
  locale: UiLocale;
}) {
  const activeItem = items[0];
  const activeKey = `${activeItem.kind}:${activeItem.entry.id}`;

  return (
    <div className="mx-auto w-full max-w-4xl">
      <ReviewCard
        key={activeKey}
        item={activeItem}
        remainingCount={items.length}
        onAnswer={(rating) =>
          onAnswer(activeItem.kind, activeItem.entry.id, rating)
        }
        onPostpone={() =>
          onPostpone(activeItem.kind, activeItem.entry.id)
        }
        locale={locale}
      />
    </div>
  );
}
```

- [ ] **Step 4: Rebuild `ReviewCard` as a large word/quote-aware shell**

Change the props:

```tsx
export function ReviewCard({
  item,
  remainingCount,
  onAnswer,
  onPostpone,
  locale,
  initiallyRevealed = false,
  busy = false,
  transitionClassName = 'review-card-enter',
}: {
  item: SrsQueueItem;
  remainingCount: number;
  onAnswer: (rating: ReviewRating) => void | Promise<void>;
  onPostpone: () => void | Promise<void>;
  locale: UiLocale;
  initiallyRevealed?: boolean;
  busy?: boolean;
  transitionClassName?: string;
}) {
```

Use quote kind as the initial answer-visible state:

```tsx
  const { entry } = item;
  const [revealed, setRevealed] = useState(
    entry.kind === 'quote' || initiallyRevealed,
  );
  const answerVisible = entry.kind === 'quote' || revealed;
  const source = getSourceLabel(entry);
```

Replace the article opening and metadata header with:

```tsx
    <article
      aria-busy={busy}
      className={`flex min-h-[420px] flex-col rounded-sm border border-border bg-paper-light p-6 shadow-md sm:p-8 ${transitionClassName}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span className="inline-flex items-center gap-1 rounded-sm border border-cinnabar-border bg-cinnabar-light px-2 py-1 font-medium text-cinnabar tracking-[1px]">
            {entry.kind === 'word' ? (
              <WholeWord className="h-3.5 w-3.5" />
            ) : (
              <MessageSquareQuote className="h-3.5 w-3.5" />
            )}
            {entry.kind === 'word'
              ? t(locale, 'review.kindWord')
              : t(locale, 'review.kindQuote')}
          </span>
          <span className="rounded-sm border border-border bg-paper-input px-2 py-1">
            {entry.status === 'inbox'
              ? t(locale, 'app.inbox')
              : t(locale, 'app.reviewed')}
          </span>
          {entry.kind === 'quote' && (
            <span className="rounded-sm border border-border bg-paper-input px-2 py-1">
              {entry.category}
            </span>
          )}
          {source && (
            <span className="max-w-64 truncate rounded-sm border border-border bg-paper-input px-2 py-1">
              {source}
            </span>
          )}
        </div>
        <span className="shrink-0 rounded-sm border border-border bg-paper-input px-3 py-1.5 text-xs text-muted">
          {formatMessage(locale, 'review.remaining', {
            count: remainingCount,
          })}
        </span>
      </div>
```

Render the word as the dominant centered prompt:

```tsx
      {entry.kind === 'word' && (
        <div className="flex min-h-[220px] flex-1 items-center justify-center py-8 text-center">
          <h2
            tabIndex={-1}
            className="text-5xl font-bold leading-tight text-ink tracking-[8px] sm:text-6xl"
          >
            {entry.text}
          </h2>
        </div>
      )}
```

Render quote content immediately:

```tsx
      {entry.kind === 'quote' && (
        <div className="flex flex-1 flex-col justify-center py-8">
          <blockquote
            tabIndex={-1}
            className="relative border-l-[3px] border-cinnabar-fade py-3 pl-7 pr-5 text-2xl leading-[2] text-ink tracking-[2px] sm:text-3xl"
          >
            <span
              aria-hidden="true"
              className="absolute left-2 top-1 text-2xl text-cinnabar/40"
            >
              「
            </span>
            <span>{entry.text}</span>
            <span
              aria-hidden="true"
              className="absolute bottom-0 right-1 text-2xl text-cinnabar/40"
            >
              」
            </span>
          </blockquote>
          {entry.note && (
            <p className="mt-5 rounded-sm border border-border bg-paper-input px-4 py-3 text-sm leading-7 text-ink-secondary">
              {entry.note}
            </p>
          )}
        </div>
      )}
```

Mount word insight only after reveal:

```tsx
      {answerVisible && entry.kind === 'word' && (
        <div className="mb-6 border-t border-border pt-4">
          <ReviewInsightReveal
            word={entry}
            locale={locale}
            initiallyRevealed
          />
        </div>
      )}
```

Replace the action area with:

```tsx
      <div className="mt-auto flex flex-wrap justify-end gap-2 border-t border-border pt-5">
        {entry.kind === 'word' && !revealed ? (
          <>
            <button
              type="button"
              onClick={() => setRevealed(true)}
              disabled={busy}
              title={t(locale, 'review.revealTitle')}
              className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-4 py-2.5 text-sm font-medium text-white shadow-sm tracking-[2px] transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Eye className="h-4 w-4" />
              {t(locale, 'review.reveal')}
            </button>
            <PostponeButton
              busy={busy}
              onPostpone={onPostpone}
              locale={locale}
            />
          </>
        ) : (
          <>
            {RATINGS.map(({ rating, labelKey, titleKey, tone }) => (
              <button
                type="button"
                key={rating}
                onClick={() => onAnswer(rating)}
                disabled={busy}
                title={t(locale, titleKey)}
                className={`inline-flex items-center gap-1 rounded-sm px-4 py-2.5 text-sm font-medium tracking-[2px] transition disabled:cursor-not-allowed disabled:opacity-50 ${toneClasses(tone)}`}
              >
                {t(locale, labelKey)}
              </button>
            ))}
            <PostponeButton
              busy={busy}
              onPostpone={onPostpone}
              locale={locale}
            />
          </>
        )}
      </div>
```

Add this helper below `ReviewCard`:

```tsx
function PostponeButton({
  busy,
  onPostpone,
  locale,
}: {
  busy: boolean;
  onPostpone: () => void | Promise<void>;
  locale: UiLocale;
}) {
  return (
    <button
      type="button"
      onClick={onPostpone}
      disabled={busy}
      title={t(locale, 'review.postponeTitle')}
      className="inline-flex items-center gap-1 rounded-sm border border-border bg-transparent px-4 py-2.5 text-sm font-medium text-ink-secondary tracking-[2px] transition hover:border-border-hover hover:bg-paper-input disabled:cursor-not-allowed disabled:opacity-50"
    >
      <RotateCw className="h-4 w-4" />
      {t(locale, 'review.postpone')}
    </button>
  );
}
```

- [ ] **Step 5: Run focused tests and compile**

Run:

```bash
npx vitest run tests/review-queue.test.tsx tests/i18n.test.ts
npm run compile
```

Expected: PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

```bash
git add entrypoints/dashboard/components/ReviewQueue.tsx tests/review-queue.test.tsx
git commit -m "feat(review): show one large word-or-quote card at a time"
```

---

## Task 3: Add Fade/Slide Advancement And Interaction Tests

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `entrypoints/dashboard/components/ReviewQueue.tsx`
- Modify: `entrypoints/dashboard/App.tsx`
- Modify: `styles.css`
- Modify: `tests/review-queue.test.tsx`

- [ ] **Step 1: Add Happy DOM for real component interaction tests**

Run:

```bash
npm install --save-dev happy-dom
```

Expected: `happy-dom` appears in `devDependencies` and the lockfile updates.

- [ ] **Step 2: Add the interactive test environment and helpers**

Add this directive at the first line of `tests/review-queue.test.tsx`:

```ts
// @vitest-environment happy-dom
```

Replace the Vitest/React imports with:

```tsx
import { act, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
```

Add after the factories:

```tsx
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & {
      IS_REACT_ACT_ENVIRONMENT: boolean;
    }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function button(label: string): HTMLButtonElement {
  const match = [...container.querySelectorAll('button')].find(
    (candidate) => candidate.textContent?.includes(label),
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function click(target: HTMLButtonElement) {
  await act(async () => {
    target.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
  });
}
```

- [ ] **Step 3: Write failing interaction tests**

Append:

```tsx
describe('ReviewQueue advancement', () => {
  it('disables actions during exit and advances to the next card', async () => {
    vi.useFakeTimers();
    const first = migrateReviewState(quote({ id: 'q1' }), NOW);
    const second = migrateReviewState(
      quote({
        id: 'q2',
        text: '温故而知新',
        note: '',
        category: 'classic',
      }),
      NOW,
    );

    function Harness() {
      const [items, setItems] = useState([
        { kind: 'quote' as const, entry: first, dueAt: NOW },
        { kind: 'quote' as const, entry: second, dueAt: NOW },
      ]);

      return (
        <ReviewQueue
          items={items}
          onAnswer={async () => {
            setItems((current) => current.slice(1));
          }}
          onPostpone={async () => {
            setItems((current) => current.slice(1));
          }}
          locale="en"
        />
      );
    }

    await renderClient(<Harness />);
    const again = button(messages.en['review.again']);
    await click(again);

    expect(again.disabled).toBe(true);
    expect(
      container.querySelector('[aria-busy="true"]'),
    ).not.toBeNull();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(container.textContent).toContain('温故而知新');
    expect(container.textContent).not.toContain('学而时习之');
    expect(document.activeElement?.textContent).toContain('温故而知新');
  });

  it('resets word reveal state when the next word becomes active', async () => {
    vi.useFakeTimers();
    const first = migrateReviewState(word({ id: 'w1', text: '你好' }), NOW);
    const second = migrateReviewState(
      word({ id: 'w2', text: '再见', normalized: '再见' }),
      NOW,
    );

    function Harness() {
      const [items, setItems] = useState([
        { kind: 'word' as const, entry: first, dueAt: NOW },
        { kind: 'word' as const, entry: second, dueAt: NOW },
      ]);

      return (
        <ReviewQueue
          items={items}
          onAnswer={async () => {
            setItems((current) => current.slice(1));
          }}
          onPostpone={async () => {
            setItems((current) => current.slice(1));
          }}
          locale="en"
        />
      );
    }

    await renderClient(<Harness />);
    await click(button(messages.en['review.reveal']));
    expect(container.textContent).toContain(messages.en['review.good']);

    await click(button(messages.en['review.good']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });

    expect(container.textContent).toContain('再见');
    expect(container.textContent).toContain(messages.en['review.reveal']);
    expect(container.textContent).not.toContain(messages.en['review.good']);
  });

  it('advances a quote without requiring Reveal', async () => {
    vi.useFakeTimers();
    const onAnswer = vi.fn().mockResolvedValue(undefined);
    const entry = migrateReviewState(quote(), NOW);

    await renderClient(
      <ReviewQueue
        items={[{ kind: 'quote', entry, dueAt: NOW }]}
        onAnswer={onAnswer}
        onPostpone={vi.fn().mockResolvedValue(undefined)}
        locale="en"
      />,
    );

    expect(container.textContent).not.toContain(
      messages.en['review.reveal'],
    );
    await click(button(messages.en['review.easy']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(180);
    });
    expect(onAnswer).toHaveBeenCalledWith('quote', 'q1', 'easy');
  });
});
```

- [ ] **Step 4: Run the interaction test to verify it fails**

Run:

```bash
npx vitest run tests/review-queue.test.tsx
```

Expected failures:

- action buttons are not disabled;
- `aria-busy` is absent;
- callbacks run without the transition;
- the queue does not coordinate exit/enter state.

- [ ] **Step 5: Add transition state to `ActiveReviewCard`**

Update the React import in
`entrypoints/dashboard/components/ReviewQueue.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
```

In `ActiveReviewCard`, add before `activeItem`:

```tsx
  const [busy, setBusy] = useState(false);
  const [exiting, setExiting] = useState(false);
  const previousActiveKey = useRef<string | null>(null);
```

Add a local delay helper outside the component:

```tsx
const REVIEW_TRANSITION_MS = 160;

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}
```

Add the transition runner inside `ActiveReviewCard`, after `activeKey`:

```tsx
  const focusOnMount =
    previousActiveKey.current !== null &&
    previousActiveKey.current !== activeKey;

  useEffect(() => {
    previousActiveKey.current = activeKey;
  }, [activeKey]);

  async function runAction(action: () => void | Promise<void>) {
    if (busy) return;
    setBusy(true);
    setExiting(true);

    try {
      await wait(REVIEW_TRANSITION_MS);
      await action();
    } finally {
      setExiting(false);
      setBusy(false);
    }
  }
```

Pass wrapped callbacks, busy state, and transition class:

```tsx
      <ReviewCard
        key={activeKey}
        item={activeItem}
        remainingCount={items.length}
        onAnswer={(rating) =>
          runAction(() =>
            onAnswer(
              activeItem.kind,
              activeItem.entry.id,
              rating,
            ),
          )
        }
        onPostpone={() =>
          runAction(() =>
            onPostpone(activeItem.kind, activeItem.entry.id),
          )
        }
        locale={locale}
        busy={busy}
        focusOnMount={focusOnMount}
        transitionClassName={
          exiting ? 'review-card-exit' : 'review-card-enter'
        }
      />
```

Because `ReviewCard` is keyed by `activeKey`, a new word card remounts with
fresh reveal state after the queue advances.

Add `focusOnMount` to `ReviewCard`:

```tsx
export function ReviewCard({
  item,
  remainingCount,
  onAnswer,
  onPostpone,
  locale,
  initiallyRevealed = false,
  busy = false,
  focusOnMount = false,
  transitionClassName = 'review-card-enter',
}: {
  item: SrsQueueItem;
  remainingCount: number;
  onAnswer: (rating: ReviewRating) => void | Promise<void>;
  onPostpone: () => void | Promise<void>;
  locale: UiLocale;
  initiallyRevealed?: boolean;
  busy?: boolean;
  focusOnMount?: boolean;
  transitionClassName?: string;
}) {
  const cardRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (focusOnMount) cardRef.current?.focus();
  }, [focusOnMount]);
```

Attach the ref and focus target to the article:

```tsx
    <article
      ref={cardRef}
      tabIndex={-1}
      aria-busy={busy}
      className={`flex min-h-[420px] flex-col rounded-sm border border-border bg-paper-light p-6 shadow-md outline-none sm:p-8 ${transitionClassName}`}
    >
```

- [ ] **Step 6: Make App callbacks return the storage mutation promises**

In `entrypoints/dashboard/App.tsx`, change:

```ts
  function answerEntry(
    kind: Entry['kind'],
    id: string,
    rating: ReviewRating,
  ) {
    const now = Date.now();
    mutate((current) =>
```

to:

```ts
  function answerEntry(
    kind: Entry['kind'],
    id: string,
    rating: ReviewRating,
  ): Promise<void> {
    const now = Date.now();
    return mutate((current) =>
```

Change `postponeEntry` similarly:

```ts
  function postponeEntry(
    kind: Entry['kind'],
    id: string,
  ): Promise<void> {
    const now = Date.now();
    const dueAt = startOfNextDay(now);
    return mutate((current) =>
```

No scheduling logic changes.

- [ ] **Step 7: Add transition CSS**

Append to `styles.css`:

```css
@keyframes review-card-enter {
  from {
    opacity: 0;
    transform: translateX(12px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.review-card-enter {
  animation: review-card-enter 160ms ease-out;
  opacity: 1;
  transform: translateX(0);
}

.review-card-exit {
  opacity: 0;
  transform: translateX(-12px);
  transition:
    opacity 160ms ease-in,
    transform 160ms ease-in;
}

@media (prefers-reduced-motion: reduce) {
  .review-card-enter {
    animation: none;
  }

  .review-card-exit {
    transform: none;
    transition: none;
  }
}
```

- [ ] **Step 8: Run focused tests and compile**

Run:

```bash
npx vitest run tests/review-queue.test.tsx tests/i18n.test.ts
npm run compile
```

Expected: PASS and TypeScript exits 0.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json entrypoints/dashboard/App.tsx entrypoints/dashboard/components/ReviewQueue.tsx styles.css tests/review-queue.test.tsx
git commit -m "feat(review): animate one-card review advancement"
```

---

## Task 4: Update README, AGENTS, Privacy, And Chrome Store Docs

Spaced repetition remains a supporting feature in store-facing copy. Use plain
“spaced repetition”; reserve “FSRS” for developer-facing README and AGENTS
architecture details.

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `PRIVACY.md`
- Modify: `docs/chrome-web-store.md`
- Modify: `docs/chrome-web-store-dashboard-checklist.md`
- Modify: `docs/chrome-web-store-reviewer-notes.md`

- [ ] **Step 1: Update README review behavior and architecture**

In the Current Status list, add a supporting feature bullet:

```md
- Focused one-card-at-a-time spaced repetition for saved words and quotes,
  with FSRS scheduling, local review analytics, and configurable retention/new
  card limits.
```

Replace the outdated paragraph:

```md
Review cards gain a **显示释义** reveal button so you can test yourself before
seeing pinyin and definitions.
```

with:

```md
In the Review tab, one large card is shown at a time. Word cards keep pinyin,
definitions, notes, examples, pronunciation, and AI insight behind
**Reveal / 查看答案**. Quote cards show their saved text and note immediately.
```

Update the Spaced Repetition section's review-flow paragraph:

```md
**Review flow:** the Review tab shows one large due card at a time.

- For a **word**, the saved word is the prompt. Click **Reveal** to see pinyin,
  definitions, notes, examples, pronunciation, and AI insight.
- For a **quote**, the saved quote and note are visible immediately because the
  current quote model has no separate answer side.

Rate the card **Again**, **Hard**, **Good**, or **Easy**. After a rating or
**Postpone**, the next due card slides into place.
```

Update Project Layout:

```text
  srs.ts                 # FSRS adapter, migration, due queue, actions, stats
  review.ts              # compatibility wrapper around the SRS queue
```

Add the focused SRS/review tests to Test Coverage:

```md
- FSRS migration, rating schedules, learning-step persistence, daily new-card
  caps, due-time wakeups, settings normalization, and one-card review UI.
```

- [ ] **Step 2: Update AGENTS.md for the landed architecture**

Add the real SRS design/plan to the implementation list:

```md
- `docs/superpowers/specs/2026-06-22-real-srs-system-design.md`
- `docs/superpowers/plans/2026-06-24-real-srs-system.md`
- `docs/superpowers/specs/2026-06-24-single-card-review-design.md`
- `docs/superpowers/plans/2026-06-24-single-card-review.md`
```

Change the landed-features sentence to:

```md
Tasks 0 through 15, Traditional Chinese conversion, TTS, the real FSRS system,
and the focused single-card review experience have landed.
```

Add focused tests:

```bash
npx vitest run tests/types-srs.test.ts
npx vitest run tests/settings.test.ts
npx vitest run tests/srs.test.ts
npx vitest run tests/review.test.ts
npx vitest run tests/review-queue.test.tsx
npx vitest run tests/backup.test.ts
```

Extend the architecture data path:

```md
11. `lib/srs.ts` is the only importer of `ts-fsrs`. It lazily migrates legacy
    review state, schedules ratings, builds the due queue, computes review
    stats, and preserves minute-scale learning steps.
12. `entrypoints/dashboard/components/ReviewQueue.tsx` renders only the first
    filtered due card. Word answers remain hidden until Reveal; quote content
    is shown immediately. Rating/postpone updates storage and the recalculated
    queue supplies the next card.
```

Add these core module entries:

```md
- `lib/srs.ts`: the only `ts-fsrs` importer; scheduler construction,
  ReviewState/Card conversion, lazy migration, ratings, postpone, due queue,
  wake time, and local review stats.
- `lib/review.ts`: compatibility wrapper that delegates queue building to
  `lib/srs.ts`.
- `lib/settings.ts`: `local:settings` storage plus normalized read, watch,
  mutation, and replacement helpers so old installs gain nested defaults.
```

Add conventions:

```md
- Keep all scheduler calls and `ts-fsrs` imports inside `lib/srs.ts`.
- Treat the SRS queue as the review-session source of truth; do not persist a
  separate current-card index.
- In Review, hide word insight until Reveal, but display quote text and notes
  immediately.
- Keep SRS state local on each entry. Do not use it for capture dedupe.
```

- [ ] **Step 3: Update privacy language**

In `PRIVACY.md`, replace the first paragraph under
`## Data The Extension Handles` with:

```md
The extension stores the text you explicitly save, your notes, pinyin,
dictionary-derived insights, review ratings, due dates, scheduling state,
review history, source page title, source page URL, source domain, surrounding
page context, extension settings, optional AI settings, and optional imported
dictionary data.
```

Add this sentence under Local Storage:

```md
Spaced-repetition ratings and schedules are calculated locally and stored on
the saved entry. They are not sent to a developer-operated service.
```

No new permissions or network requests are introduced.

- [ ] **Step 4: Quietly update Chrome Web Store submission notes**

In `docs/chrome-web-store.md`, replace the Single Purpose paragraph with:

```md
Capture selected Chinese words, phrases, and quotes while reading, store them
locally, enrich them with local dictionary and review tools, and export daily
Markdown notes.
```

Replace the User Data Disclosure paragraph with:

```md
Disclose that the extension handles website content selected by the user, page
metadata for captured sources, user notes, local review ratings and schedules,
extension settings, and optional API keys. Data is stored locally by default.
Spaced-repetition scheduling does not require network access. AI provider
transfer occurs only after the user enables AI and clicks an AI action. When
pronunciation is requested, the selected saved word is passed to Chrome's
configured speech engine; some installed voices may use a remote speech
resource.
```

Do not add a new permission justification because the review system uses
existing local storage only.

- [ ] **Step 5: Quietly update the dashboard checklist**

In the detailed description's Core features list, add:

```text
- Review saved words and quotes one card at a time with local spaced-repetition scheduling.
```

Under User Data Disclosure, replace the “User activity” bullet with:

```md
- User activity: saved review ratings, schedules, notes, and explicit export
  actions inside the extension.
```

Replace the suggested explanation with:

```text
The extension stores selected text, notes, source metadata, review ratings and schedules, local settings, optional API keys, and generated AI insights locally in the user's browser. Spaced-repetition ratings and schedules are calculated and stored locally. AI data transfer happens only when the user enables AI and explicitly clicks an AI action. When pronunciation is requested, the saved word is passed to Chrome's configured speech engine; some installed voices may use a remote speech resource. The extension does not operate a developer-owned server, does not create accounts, and does not sell user data.
```

Keep the short description unchanged so SRS remains a supporting feature.

- [ ] **Step 6: Update reviewer notes and smoke test**

In Suggested Reviewer Notes, add one sentence:

```text
The Review tab shows one due card at a time and schedules it locally from the user's Again, Hard, Good, or Easy rating. Word details are revealed on demand; saved quote text is shown immediately.
```

Insert after the pronunciation step in Manual Test Script:

```md
11. Open the **Review** tab. Confirm only one large card is visible.
12. For a word, click **Reveal / 查看答案**, choose a rating, and confirm the next
    due card replaces it.
13. For a quote, confirm its text is visible immediately without a Reveal
    button, then choose a rating.
14. Click the daily Markdown export action and confirm Chrome downloads a
    `.md` file.
15. Click the zip export action and confirm Chrome downloads a `.zip` file.
16. Click the backup action and confirm Chrome downloads a `.json` backup file.
17. Open Settings from the dashboard.
18. Change the UI language between `zh-CN` and English, then return to the
    dashboard to confirm labels update.
19. Optional AI test: enable AI, choose DeepSeek or OpenAI, enter a valid API
    key, click Test Connection, return to a saved word, and click Ask AI.
```

Replace the old steps 11–16 with the new steps 11–19 above.

Add under Privacy Boundary:

```md
- Review ratings, schedules, and history stay in local extension storage.
```

- [ ] **Step 7: Verify documentation consistency**

Run:

```bash
rg -n "all cards|vertical list|显示释义|shows the prompt first|Reveal" \
  README.md AGENTS.md PRIVACY.md docs/chrome-web-store*.md
git diff --check
```

Expected:

- no store-facing headline promotes FSRS;
- README and AGENTS may name FSRS in developer/feature details;
- quote review documentation never says quote content is hidden;
- no whitespace errors.

- [ ] **Step 8: Commit**

```bash
git add README.md AGENTS.md PRIVACY.md docs/chrome-web-store.md docs/chrome-web-store-dashboard-checklist.md docs/chrome-web-store-reviewer-notes.md
git commit -m "docs(review): update single-card review and store guidance"
```

---

## Task 5: Full Verification And Build

**Files:** none unless verification exposes a required fix.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npx vitest run tests/review-queue.test.tsx tests/i18n.test.ts tests/srs.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run compile**

Run:

```bash
npm run compile
```

Expected: exits 0 with no TypeScript errors.

- [ ] **Step 3: Run the complete test suite**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Run the production build and inspect the manifest**

Run:

```bash
npm run build
cat .output/chrome-mv3/manifest.json
```

Expected:

- build exits 0;
- no new SRS/review permission is present;
- existing permissions remain `contextMenus`, `storage`, `activeTab`,
  `scripting`, `downloads`, `unlimitedStorage`, `clipboardRead`, and `tts`;
- command shortcuts, toolbar popup, and MV3 service worker remain present.

- [ ] **Step 5: Inspect the final diff**

Run:

```bash
git status --short
git diff --check
git diff --stat HEAD~4..HEAD
```

Expected: clean worktree after commits, no whitespace errors, and changes
limited to review UI/tests, test dependency, styles, and requested
documentation.

---

## Acceptance Criteria Traceability

| Requirement | Covered by |
|---|---|
| Only one review card appears at a time | Task 2 static test and `items[0]` rendering |
| Card is larger in Review | Task 2 layout test and `min-h-[420px]` shell |
| Word text visible, details hidden until Reveal | Task 2 word tests |
| Quote text/note visible immediately | Task 2 quote test |
| Quote has no Reveal/Show Answer copy | Task 2 quote test |
| Rating/postpone advances to recalculated next card | Task 3 interaction test |
| Word reveal resets for the next card | Task 3 interaction test |
| Quick fade/slide transition | Task 3 state and CSS |
| Reduced-motion support | Task 3 CSS |
| Queue remains FSRS source of truth | Tasks 2–3; no index or persisted session state |
| README, AGENTS, privacy, and Chrome docs updated quietly | Task 4 |
| Compile, tests, and build pass | Task 5 |
