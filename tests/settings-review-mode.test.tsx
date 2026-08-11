// @vitest-environment happy-dom

import { fakeBrowser } from '@webext-core/fake-browser';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SettingsApp } from '../entrypoints/settings/SettingsApp';
import { registerSyncMutationHandler } from '../entrypoints/background/sync-mutation-handler';
import { getSettings, replaceSettings } from '../lib/settings';
import { messages } from '../lib/i18n';

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  fakeBrowser.reset();
  // requestSyncMutation() (used by useSettings().mutate) sends a runtime
  // message that the background service worker normally answers. fake-browser
  // has no background context running by default, so register the same
  // handler the background entrypoint installs (see tests/capture-undo.test.ts
  // for the identical pattern) or the message silently has no listener.
  registerSyncMutationHandler();
  await replaceSettings({ ...(await getSettings()), uiLocale: 'en' });
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render() {
  await act(async () => {
    root.render(<SettingsApp />);
  });
}

describe('review mode setting', () => {
  it('shows both modes', async () => {
    await render();
    expect(container.textContent).toContain(messages.en['settings.modeSrs']);
    expect(container.textContent).toContain(messages.en['settings.modeDrift']);
  });

  it('starts on spaced repetition', async () => {
    await render();
    const srs = container.querySelector<HTMLInputElement>('[data-testid="review-mode-srs"]')!;
    expect(srs.checked).toBe(true);
  });

  it('persists a switch to drift', async () => {
    await render();
    await act(async () => {
      container
        .querySelector<HTMLInputElement>('[data-testid="review-mode-drift"]')!
        .click();
    });
    expect((await getSettings()).reviewMode).toBe('drift');
  });

  it('switches back without touching the SRS knobs', async () => {
    await render();
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="review-mode-drift"]')!.click();
    });
    await act(async () => {
      container.querySelector<HTMLInputElement>('[data-testid="review-mode-srs"]')!.click();
    });
    const settings = await getSettings();
    expect(settings.reviewMode).toBe('srs');
    expect(settings.srs.newCardsPerDay).toBe(20);
  });
});
