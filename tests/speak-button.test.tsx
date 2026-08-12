// @vitest-environment happy-dom

import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SpeakButton } from '../entrypoints/dashboard/components/SpeakButton';
import type { TtsState } from '../lib/tts';

const getTtsState = vi.fn((): TtsState => ({ status: 'idle' }));
const isChineseVoiceAvailable = vi.fn(() => true);
const speak = vi.fn();
const stop = vi.fn();

vi.mock('../lib/tts', () => ({
  getTtsState: () => getTtsState(),
  // Mirrors the real signature: initTts resolves voices and returns the
  // state, which the component seeds itself from.
  initTts: () => getTtsState(),
  isChineseVoiceAvailable: () => isChineseVoiceAvailable(),
  speak: (text: string) => speak(text),
  stop: () => stop(),
  subscribeTts: () => () => {},
}));

describe('SpeakButton', () => {
  beforeEach(() => {
    getTtsState.mockReturnValue({ status: 'idle' });
    isChineseVoiceAvailable.mockReturnValue(true);
    speak.mockClear();
    stop.mockClear();
  });

  it('renders nothing when no Chinese voice is available', () => {
    isChineseVoiceAvailable.mockReturnValue(false);

    const html = renderToStaticMarkup(<SpeakButton text="你好" locale="en" />);

    expect(html).toBe('');
  });

  it('renders the speaker control when idle', () => {
    const html = renderToStaticMarkup(<SpeakButton text="你好" locale="en" />);

    expect(html).toContain('aria-label="Pronounce"');
    expect(html).toMatch(/lucide-volume/);
  });

  it('shows a failure affordance when this text failed to synthesize', () => {
    getTtsState.mockReturnValue({ status: 'error', text: '你好' });

    const html = renderToStaticMarkup(<SpeakButton text="你好" locale="en" />);

    expect(html).toMatch(/lucide-[a-z-]*alert/);
    expect(html).toContain('Pronunciation failed');
    expect(html).not.toContain('aria-label="Pronounce"');
  });

  it('leaves other words alone when one fails', () => {
    // The error state is keyed to the text that failed, so the rest of the
    // page must not light up with alert icons.
    getTtsState.mockReturnValue({ status: 'error', text: '你好' });

    const html = renderToStaticMarkup(<SpeakButton text="世界" locale="en" />);

    expect(html).toContain('aria-label="Pronounce"');
    expect(html).not.toContain('Pronunciation failed');
  });

  it('marks the failed control as not pressed', () => {
    getTtsState.mockReturnValue({ status: 'error', text: '你好' });

    const html = renderToStaticMarkup(<SpeakButton text="你好" locale="en" />);

    expect(html).toContain('aria-pressed="false"');
  });

  it('stays clickable after a failure so the user can retry', () => {
    getTtsState.mockReturnValue({ status: 'error', text: '你好' });

    const html = renderToStaticMarkup(<SpeakButton text="你好" locale="en" />);

    expect(html).not.toMatch(/<button[^>]*disabled=""/);
  });
});
