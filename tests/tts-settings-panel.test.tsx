// @vitest-environment happy-dom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsSettingsPanel } from '../entrypoints/settings/TtsSettingsPanel';
import { DEFAULT_TTS_SETTINGS } from '../lib/tts-voices';
import type { TtsSettings } from '../lib/types';

const listVoiceCandidates = vi.fn();
const getSelectedVoiceName = vi.fn(() => 'Tingting');

vi.mock('../lib/tts', () => ({
  configureTts: vi.fn(),
  initTts: vi.fn(),
  speak: vi.fn(),
  getTtsState: () => ({ status: 'idle' }),
  subscribeTts: () => () => {},
  listVoiceCandidates: () => listVoiceCandidates(),
  getSelectedVoiceName: () => getSelectedVoiceName(),
}));

function voice(name: string, overrides: Record<string, unknown> = {}) {
  return {
    name,
    lang: 'zh-CN',
    isRemote: false,
    isDefault: false,
    engines: ['web'],
    index: 0,
    ...overrides,
  };
}

/**
 * Owns the `settings` prop the way SettingsApp does: a rerender can hand
 * TtsSettingsPanel a brand-new `tts` object (normalizeSettings rebuilds it on
 * every settings write) without the TTS values themselves changing. `onSave`
 * intentionally does NOT feed back into this state, so it isolates the
 * resync effect from the panel's own onChange handlers.
 */
function RateInputHarness({ onSave }: { onSave: (next: TtsSettings) => void }) {
  const [settings, setSettings] = useState<TtsSettings>({ ...DEFAULT_TTS_SETTINGS });
  return (
    <div>
      <button
        type="button"
        data-testid="unrelated-write"
        onClick={() => setSettings((prev) => ({ ...prev }))}
      >
        unrelated write
      </button>
      <TtsSettingsPanel settings={settings} locale="en" onSave={onSave} />
    </div>
  );
}

async function setRangeValue(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    setter.call(el, value);
    // React tracks range-input onChange via the 'input' event, not 'change'
    // (matching the textarea pattern used elsewhere in this test suite).
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

describe('TtsSettingsPanel', () => {
  beforeEach(() => {
    listVoiceCandidates.mockReturnValue([voice('Tingting')]);
    getSelectedVoiceName.mockReturnValue('Tingting');
  });

  it('renders the voice, rate, and network controls', () => {
    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('Pronunciation');
    expect(html).toContain('Voice');
    expect(html).toContain('Speed');
    expect(html).toContain('Allow network voices');
    expect(html).toContain('Tingting');
    expect(html).toContain('Auto (best available)');
  });

  it('disables remote voices until network voices are allowed', () => {
    listVoiceCandidates.mockReturnValue([
      voice('Tingting'),
      voice('Google 普通话', { isRemote: true, index: 1 }),
    ]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('Network');
    expect(html).toMatch(/<option[^>]*disabled[^>]*>[^<]*Google 普通话/);
  });

  it('enables remote voices once allowed', () => {
    listVoiceCandidates.mockReturnValue([
      voice('Google 普通话', { isRemote: true, index: 1 }),
    ]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel
        settings={{ ...DEFAULT_TTS_SETTINGS, allowNetworkVoices: true }}
        locale="en"
        onSave={vi.fn()}
      />,
    );

    expect(html).not.toMatch(/<option[^>]*disabled[^>]*>[^<]*Google 普通话/);
  });

  it('flags the OS system voice', () => {
    listVoiceCandidates.mockReturnValue([voice('Tingting', { isDefault: true })]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('System');
  });

  it('warns when the saved voice is unavailable', () => {
    getSelectedVoiceName.mockReturnValue('Tingting');

    const html = renderToStaticMarkup(
      <TtsSettingsPanel
        settings={{ ...DEFAULT_TTS_SETTINGS, voiceName: 'Removed Voice' }}
        locale="en"
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('The saved voice is unavailable');
  });

  it('explains the empty state instead of rendering dead controls', () => {
    listVoiceCandidates.mockReturnValue([]);

    const html = renderToStaticMarkup(
      <TtsSettingsPanel settings={DEFAULT_TTS_SETTINGS} locale="en" onSave={vi.fn()} />,
    );

    expect(html).toContain('No Chinese voice is installed on this system.');
    expect(html).not.toContain('Speed');
  });

  it('warns when a saved network voice is present but gated off by allowNetworkVoices', () => {
    // The voice is still installed (present in the candidate list under its
    // saved name), so the "missing" check alone would stay quiet. But
    // selectVoice() falls back to a different voice once network voices are
    // disallowed, so the <select> would silently show a voice that is not
    // actually in use.
    listVoiceCandidates.mockReturnValue([
      voice('Tingting'),
      voice('Google 普通话', { isRemote: true, index: 1 }),
    ]);
    getSelectedVoiceName.mockReturnValue('Tingting');

    const html = renderToStaticMarkup(
      <TtsSettingsPanel
        settings={{ ...DEFAULT_TTS_SETTINGS, voiceName: 'Google 普通话', allowNetworkVoices: false }}
        locale="en"
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('The saved voice is unavailable');
  });

  describe('draft resync on unrelated settings writes', () => {
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
      await act(async () => root.unmount());
      container.remove();
    });

    it('does not reset an in-progress rate drag when an unrelated setting is rewritten elsewhere', async () => {
      await act(async () => {
        root.render(<RateInputHarness onSave={() => {}} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;
      expect(rateInput().value).toBe(String(DEFAULT_TTS_SETTINGS.rate));

      await setRangeValue(rateInput(), '1.5');
      expect(rateInput().value).toBe('1.5');

      // Simulate an unrelated settings write elsewhere in the app:
      // normalizeSettings rebuilds the `tts` object on every write, so this
      // settings prop becomes a new reference carrying the SAME tts values
      // that were in effect before the drag started.
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="unrelated-write"]')!.click();
      });

      expect(rateInput().value).toBe('1.5');
    });
  });
});
