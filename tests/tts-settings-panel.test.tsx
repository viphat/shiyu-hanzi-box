import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TtsSettingsPanel } from '../entrypoints/settings/TtsSettingsPanel';
import { DEFAULT_TTS_SETTINGS } from '../lib/tts-voices';

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
});
