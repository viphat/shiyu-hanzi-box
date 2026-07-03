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

  it('traps Tab focus inside the dialog', async () => {
    await render(<OnboardingCarousel locale="en" onClose={() => {}} />);
    const buttons = [...container.querySelectorAll('button')] as HTMLButtonElement[];
    const first = buttons[0];
    const last = buttons[buttons.length - 1];

    last.focus();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })),
    );
    expect(document.activeElement).toBe(first);

    first.focus();
    await act(async () =>
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true })),
    );
    expect(document.activeElement).toBe(last);
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
