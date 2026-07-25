// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TranslateButtons,
  type TranslateSlot,
} from '../entrypoints/dashboard/components/TranslateButtons';
import { messages } from '../lib/i18n';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
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
});

async function renderClient(node: ReactNode) {
  await act(async () => {
    root.render(node);
  });
}

function queryButton(label: string): HTMLButtonElement | null {
  return (
    [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes(label),
    ) ?? null
  ) as HTMLButtonElement | null;
}

async function click(btn: HTMLButtonElement) {
  await act(async () => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

const IDLE: TranslateSlot = { state: 'idle' };

function props(over: Partial<Parameters<typeof TranslateButtons>[0]> = {}) {
  return {
    google: IDLE,
    ai: IDLE,
    hasGoogle: false,
    hasAi: false,
    shownGoogle: false,
    shownAi: false,
    onTranslateGoogle: vi.fn(),
    onTranslateAi: vi.fn(),
    onToggleGoogle: vi.fn(),
    onToggleAi: vi.fn(),
    locale: 'en' as const,
    ...over,
  };
}

describe('TranslateButtons', () => {
  it('renders both generate chips when no translation exists', async () => {
    await renderClient(<TranslateButtons {...props()} />);
    expect(queryButton(messages.en['translate.googleShort'])).not.toBeNull();
    expect(queryButton(messages.en['translate.aiShort'])).not.toBeNull();
  });

  it('calls onTranslateGoogle when the Google chip is clicked', async () => {
    const p = props();
    await renderClient(<TranslateButtons {...p} />);
    await click(queryButton(messages.en['translate.googleShort'])!);
    expect(p.onTranslateGoogle).toHaveBeenCalledTimes(1);
    expect(p.onTranslateAi).not.toHaveBeenCalled();
  });

  it('calls onTranslateAi when the AI chip is clicked', async () => {
    const p = props();
    await renderClient(<TranslateButtons {...p} />);
    await click(queryButton(messages.en['translate.aiShort'])!);
    expect(p.onTranslateAi).toHaveBeenCalledTimes(1);
    expect(p.onTranslateGoogle).not.toHaveBeenCalled();
  });

  it('shows a disabled loading chip while a slot is in flight', async () => {
    await renderClient(<TranslateButtons {...props({ google: { state: 'loading' } })} />);
    const chip = queryButton(messages.en['translate.loading'])!;
    expect(chip).not.toBeNull();
    expect(chip.disabled).toBe(true);
  });

  it('disables the AI chip and explains when AI is not configured', async () => {
    await renderClient(
      <TranslateButtons
        {...props({ ai: { state: 'disabled', failure: 'not-configured' } })}
      />,
    );
    const chip = queryButton(messages.en['translate.aiShort'])!;
    expect(chip.disabled).toBe(true);
    expect(chip.title).toBe(messages.en['translate.errNotConfigured']);
  });

  it('renders no inline message when a slot has a translation, even in an error state', async () => {
    await renderClient(
      <TranslateButtons
        {...props({
          hasGoogle: true,
          google: { state: 'error', failure: 'rate-limited' },
        })}
      />,
    );
    expect(container.textContent).not.toContain(messages.en['translate.errRateLimited']);
  });

  it('offers Retry with a localized message on a rate-limited failure', async () => {
    const p = props({ google: { state: 'error', failure: 'rate-limited' } });
    await renderClient(<TranslateButtons {...p} />);
    expect(container.textContent).toContain(messages.en['translate.errRateLimited']);
    await click(queryButton(messages.en['translate.retry'])!);
    expect(p.onTranslateGoogle).toHaveBeenCalledTimes(1);
  });

  it('appends the provider detail after the localized message', async () => {
    await renderClient(
      <TranslateButtons
        {...props({ ai: { state: 'error', failure: 'unreachable', detail: 'upstream down' } })}
      />,
    );
    expect(container.textContent).toContain(messages.en['translate.errUnreachable']);
    expect(container.textContent).toContain('upstream down');
  });

  it('shows independent error lines for both slots at once', async () => {
    await renderClient(
      <TranslateButtons
        {...props({
          google: { state: 'error', failure: 'rate-limited' },
          ai: { state: 'error', failure: 'unexpected' },
        })}
      />,
    );
    expect(container.textContent).toContain(messages.en['translate.errRateLimited']);
    expect(container.textContent).toContain(messages.en['translate.errUnexpected']);
  });

  it('turns a chip into a hide toggle once its translation exists and is shown', async () => {
    const p = props({ hasGoogle: true, shownGoogle: true });
    await renderClient(<TranslateButtons {...p} />);
    const chip = queryButton(messages.en['translate.googleShort'])!;
    expect(chip.title).toBe(messages.en['translate.hideGoogle']);
    await click(chip);
    expect(p.onToggleGoogle).toHaveBeenCalledTimes(1);
    expect(p.onTranslateGoogle).not.toHaveBeenCalled();
  });

  it('titles the chip as a show toggle when the translation is hidden', async () => {
    await renderClient(<TranslateButtons {...props({ hasAi: true, shownAi: false })} />);
    expect(queryButton(messages.en['translate.aiShort'])!.title).toBe(
      messages.en['translate.showAi'],
    );
  });

  it('wraps error messages in a div, not a span', async () => {
    // A <p> inside a <span> is invalid phrasing content; browsers restructure
    // it and the flex footer layout breaks. textContent assertions can't see
    // this, so pin the element type directly.
    await renderClient(
      <TranslateButtons
        {...props({ ai: { state: 'error', failure: 'not-configured' } })}
      />,
    );
    const wrapper = container.querySelector('.basis-full');
    expect(wrapper).not.toBeNull();
    expect(wrapper!.tagName).toBe('DIV');
  });

  it('renders zh-CN strings when the locale is zh-CN', async () => {
    await renderClient(
      <TranslateButtons {...props({ google: { state: 'loading' }, locale: 'zh-CN' })} />
    );
    expect(container.textContent).toContain(messages['zh-CN']['translate.loading']);
    expect(container.textContent).not.toContain(messages.en['translate.loading']);
  });
});
