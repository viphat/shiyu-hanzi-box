// @vitest-environment happy-dom

import { act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const onboardingMocks = vi.hoisted(() => ({
  getOnboardingSeen: vi.fn<() => Promise<boolean>>(),
  markOnboardingSeen: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/lib/onboarding', () => onboardingMocks);

import { useOnboarding } from '../entrypoints/dashboard/hooks/useOnboarding';

let container: HTMLDivElement;
let root: Root;

function Harness() {
  const { open, loading, close, openManually } = useOnboarding();
  return (
    <div>
      <span data-testid="open">{String(open)}</span>
      <span data-testid="loading">{String(loading)}</span>
      <button data-testid="close" onClick={close}>close</button>
      <button data-testid="open-btn" onClick={openManually}>open</button>
    </div>
  );
}

beforeEach(() => {
  onboardingMocks.getOnboardingSeen.mockReset();
  onboardingMocks.markOnboardingSeen.mockReset();
  onboardingMocks.getOnboardingSeen.mockResolvedValue(false);
  onboardingMocks.markOnboardingSeen.mockResolvedValue(undefined);
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

const openText = () => container.querySelector('[data-testid="open"]')!.textContent;
const loadingText = () => container.querySelector('[data-testid="loading"]')!.textContent;
const clickTestId = async (id: string) =>
  act(async () =>
    container.querySelector(`[data-testid="${id}"]`)!
      .dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('useOnboarding', () => {
  it('stays loading until the flag read resolves', async () => {
    const pending = deferred<boolean>();
    onboardingMocks.getOnboardingSeen.mockReturnValueOnce(pending.promise);
    await act(async () => root.render(<Harness />));
    expect(loadingText()).toBe('true');
    expect(openText()).toBe('false');

    await act(async () => {
      pending.resolve(false);
      await pending.promise;
    });
    expect(loadingText()).toBe('false');
    expect(openText()).toBe('true');
  });

  it('opens on mount when the flag is unseen', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {}); // flush the async flag read
    expect(loadingText()).toBe('false');
    expect(openText()).toBe('true');
  });

  it('stays closed on mount when already seen', async () => {
    onboardingMocks.getOnboardingSeen.mockResolvedValueOnce(true);
    await act(async () => root.render(<Harness />));
    await act(async () => {});
    expect(loadingText()).toBe('false');
    expect(openText()).toBe('false');
  });

  it('close() marks seen and closes', async () => {
    await act(async () => root.render(<Harness />));
    await act(async () => {});
    await clickTestId('close');
    expect(openText()).toBe('false');
    expect(onboardingMocks.markOnboardingSeen).toHaveBeenCalledTimes(1);
  });

  it('openManually() opens without marking seen', async () => {
    onboardingMocks.getOnboardingSeen.mockResolvedValueOnce(true);
    await act(async () => root.render(<Harness />));
    await act(async () => {});
    await clickTestId('open-btn');
    expect(openText()).toBe('true');
    expect(onboardingMocks.markOnboardingSeen).not.toHaveBeenCalled();
  });
});
