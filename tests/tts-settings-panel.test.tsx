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
      <button
        type="button"
        data-testid="external-rate-write"
        // Simulates a genuinely different write landing from elsewhere —
        // e.g. storage.local firing a cross-tab change event because a
        // second open Settings page saved its own rate — rather than the
        // same values being rebuilt into a new object reference.
        onClick={() => setSettings((prev) => ({ ...prev, rate: 0.6 }))}
      >
        external rate write
      </button>
      <button
        type="button"
        data-testid="external-voice-write"
        // A genuinely different write that does NOT touch rate. A drag in
        // flight must survive it, and the drag must not later overwrite the
        // voice this landed.
        onClick={() => setSettings((prev) => ({ ...prev, voiceName: 'Meijia' }))}
      >
        external voice write
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

async function fireOnRange(el: HTMLInputElement, type: string) {
  await act(async () => {
    el.dispatchEvent(new Event(type, { bubbles: true }));
  });
}

async function setSelectValue(el: HTMLSelectElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function toggleCheckbox(el: HTMLInputElement) {
  // React tracks checkbox/radio changes via the native 'click' event rather
  // than 'change' (ChangeEventPlugin), so a real click — which also flips
  // `checked` itself — is what a manual event dispatch must reproduce.
  await act(async () => {
    el.click();
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

  describe('commit-on-release for the rate slider', () => {
    let container: HTMLDivElement;
    let root: Root;

    beforeEach(() => {
      (
        globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
      ).IS_REACT_ACT_ENVIRONMENT = true;
      container = document.createElement('div');
      document.body.append(container);
      root = createRoot(container);
      listVoiceCandidates.mockReturnValue([
        voice('Tingting'),
        voice('Meijia', { lang: 'zh-TW', index: 1 }),
      ]);
    });

    afterEach(async () => {
      await act(async () => root.unmount());
      container.remove();
    });

    it('does not persist intermediate values while dragging, but keeps the displayed value live', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.1');
      await setRangeValue(rateInput(), '1.2');
      await setRangeValue(rateInput(), '1.3');

      expect(rateInput().value).toBe('1.3');
      expect(onSave).not.toHaveBeenCalled();
    });

    it('persists exactly once, with the final rate, when the pointer is released', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.1');
      await setRangeValue(rateInput(), '1.2');
      await setRangeValue(rateInput(), '1.3');
      await fireOnRange(rateInput(), 'pointerup');

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.3 }),
      );
    });

    it('persists on keyup after an arrow-key adjustment', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.1');
      expect(onSave).not.toHaveBeenCalled();

      await fireOnRange(rateInput(), 'keyup');

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.1 }),
      );
    });

    it('persists on blur as a backstop when a pointer release is missed', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.4');
      expect(onSave).not.toHaveBeenCalled();

      // React delegates onBlur through the native 'focusout' event, since
      // 'blur' itself does not bubble.
      await fireOnRange(rateInput(), 'focusout');

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.4 }),
      );
    });

    it('still persists the voice selection immediately, on every change', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const voiceSelect = container.querySelector<HTMLSelectElement>('#tts-voice')!;
      await setSelectValue(voiceSelect, 'Meijia');

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ voiceName: 'Meijia' }),
      );
    });

    it('still persists the network-voices checkbox immediately, on every change', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
      await toggleCheckbox(checkbox);

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ allowNetworkVoices: true }),
      );
    });

    it('flushes an uncommitted drag on unmount instead of dropping it', async () => {
      // Removing a focused element from the DOM does not fire blur/focusout
      // in real browsers (document.activeElement silently moves to <body>),
      // so blur cannot be relied on to save a drag that is still in flight
      // when the panel unmounts — e.g. the user drags the slider and then
      // navigates away without releasing over the input.
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.1');
      await setRangeValue(rateInput(), '1.3');
      expect(onSave).not.toHaveBeenCalled();

      await act(async () => root.unmount());

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.3 }),
      );
    });

    it('does not fire a duplicate save on unmount after a normal commit', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.2');
      await fireOnRange(rateInput(), 'pointerup');
      expect(onSave).toHaveBeenCalledTimes(1);

      await act(async () => root.unmount());

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('does not save twice when a sibling field is committed mid-drag', async () => {
      // Committing the voice select saves the draft, which already carries the
      // rate the drag has reached — so the rate is no longer uncommitted. If it
      // stayed pending, the eventual release would write the identical object a
      // second time.
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;
      const voiceSelect = () => container.querySelector<HTMLSelectElement>('#tts-voice')!;

      await setRangeValue(rateInput(), '1.3');
      expect(onSave).not.toHaveBeenCalled();

      await setSelectValue(voiceSelect(), 'Meijia');
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.3, voiceName: 'Meijia' }),
      );

      await fireOnRange(rateInput(), 'pointerup');

      expect(onSave).toHaveBeenCalledTimes(1);
    });

    it('keeps an in-flight drag when an unrelated field is written externally', async () => {
      // The resync effect used to reset the whole draft — and clear the
      // pending drag — whenever ANY of the three fields changed. So an
      // external voice write landing mid-drag snapped the slider back and
      // made the subsequent release save nothing, silently losing the edit.
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.3');
      expect(rateInput().value).toBe('1.3');

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="external-voice-write"]')!.click();
      });

      // The drag survives a write that did not touch rate.
      expect(rateInput().value).toBe('1.3');

      await fireOnRange(rateInput(), 'pointerup');

      // And committing it carries the externally-written voice rather than
      // rewriting the pre-drag one over the top of it.
      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.3, voiceName: 'Meijia' }),
      );
    });

    it('flushes a drag on unmount without clobbering an unrelated external write', async () => {
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.4');
      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="external-voice-write"]')!.click();
      });

      await act(async () => root.unmount());

      expect(onSave).toHaveBeenCalledTimes(1);
      expect(onSave).toHaveBeenLastCalledWith(
        expect.objectContaining({ rate: 1.4, voiceName: 'Meijia' }),
      );
    });

    it('drops a stale uncommitted drag instead of flushing it over a fresher external write on unmount', async () => {
      // Reproduces: user drags to 1.3 (uncommitted) -> an external write
      // lands with rate 0.6 (e.g. storage.local firing cross-tab because a
      // second open Settings page saved its own change) -> the resync
      // effect updates the visible slider to 0.6 -> the panel unmounts
      // before any release event. The unmount flush must not resurrect the
      // stale 1.3 over the newer value already on screen.
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await setRangeValue(rateInput(), '1.1');
      await setRangeValue(rateInput(), '1.3');
      expect(rateInput().value).toBe('1.3');
      expect(onSave).not.toHaveBeenCalled();

      await act(async () => {
        container.querySelector<HTMLButtonElement>('[data-testid="external-rate-write"]')!.click();
      });
      expect(rateInput().value).toBe('0.6');

      await act(async () => root.unmount());

      expect(onSave).not.toHaveBeenCalled();
    });

    it('does not save on blur when nothing was dragged', async () => {
      // A bare focus/blur with no intervening drag must not write to
      // storage: commitRate() should only flush an actually-pending value,
      // not re-save whatever draft happens to be in state.
      const onSave = vi.fn();
      await act(async () => {
        root.render(<RateInputHarness onSave={onSave} />);
      });

      const rateInput = () => container.querySelector<HTMLInputElement>('#tts-rate')!;

      await fireOnRange(rateInput(), 'focusout');

      expect(onSave).not.toHaveBeenCalled();
    });
  });
});
