import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

class MockSpeechSynthesisUtterance {
  text: string;
  lang = '';
  voice: SpeechSynthesisVoice | null = null;
  volume = 1;
  rate = 1;
  pitch = 1;
  onend: ((event: SpeechSynthesisEvent) => void) | null = null;
  onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;

  constructor(text = '') {
    this.text = text;
  }
}

function createMockVoice(lang: string, name: string): SpeechSynthesisVoice {
  return {
    default: false,
    lang,
    localService: true,
    name,
    voiceURI: name,
  };
}

type MockSpeechSynthesis = {
  getVoices: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  cancel: ReturnType<typeof vi.fn>;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

let mockVoices: SpeechSynthesisVoice[] = [];
let speakCalls: MockSpeechSynthesisUtterance[] = [];
let voiceListeners: Array<() => void> = [];

function createMockSpeechSynthesis(): MockSpeechSynthesis {
  speakCalls = [];
  voiceListeners = [];

  return {
    getVoices: vi.fn(() => mockVoices),
    speak: vi.fn((utterance: MockSpeechSynthesisUtterance) => {
      speakCalls.push(utterance);
    }),
    cancel: vi.fn(),
    addEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'voiceschanged') {
        voiceListeners.push(listener);
      }
    }),
    removeEventListener: vi.fn((type: string, listener: () => void) => {
      if (type === 'voiceschanged') {
        voiceListeners = voiceListeners.filter((candidate) => candidate !== listener);
      }
    }),
  };
}

function emitVoicesChanged() {
  for (const listener of voiceListeners) {
    listener();
  }
}

describe('tts', () => {
  let speechSynthesis: MockSpeechSynthesis;

  beforeEach(() => {
    mockVoices = [];
    speechSynthesis = createMockSpeechSynthesis();
    vi.stubGlobal('speechSynthesis', speechSynthesis);
    vi.stubGlobal('SpeechSynthesisUtterance', MockSpeechSynthesisUtterance);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function importTts() {
    return await import('../lib/tts');
  }

  async function initWithVoices(voices: SpeechSynthesisVoice[]) {
    mockVoices = voices;
    const tts = await importTts();
    tts.initTts();
    speechSynthesis.speak.mockClear();
    speechSynthesis.cancel.mockClear();
    speakCalls = [];
    return tts;
  }

  it('reports unavailable before voices load', async () => {
    const { getTtsState, initTts, isChineseVoiceAvailable } = await importTts();

    initTts();

    expect(isChineseVoiceAvailable()).toBe(false);
    expect(getTtsState()).toEqual({ status: 'unavailable' });
  });

  it('detects a zh-CN voice and warms up once', async () => {
    mockVoices = [createMockVoice('zh-CN', 'Google Mandarin')];
    const { initTts, isChineseVoiceAvailable } = await importTts();

    initTts();
    initTts();

    expect(isChineseVoiceAvailable()).toBe(true);
    expect(speechSynthesis.addEventListener).toHaveBeenCalledTimes(1);
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(speakCalls[0].text).toBe('一');
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('detects voices when Chrome resolves them later', async () => {
    const { getTtsState, initTts, isChineseVoiceAvailable } = await importTts();

    initTts();
    mockVoices = [createMockVoice('zh-CN', 'Google Mandarin')];
    emitVoicesChanged();

    expect(isChineseVoiceAvailable()).toBe(true);
    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('falls back to zh-TW when zh-CN is absent', async () => {
    const { isChineseVoiceAvailable } = await initWithVoices([
      createMockVoice('zh-TW', 'Mei-Jia'),
      createMockVoice('en-US', 'Samantha'),
    ]);

    expect(isChineseVoiceAvailable()).toBe(true);
  });

  it('reports unavailable when only en-US voices exist', async () => {
    const { getTtsState, isChineseVoiceAvailable } = await initWithVoices([
      createMockVoice('en-US', 'Samantha'),
    ]);

    expect(isChineseVoiceAvailable()).toBe(false);
    expect(getTtsState()).toEqual({ status: 'unavailable' });
  });

  it('speaks text with the Chinese voice', async () => {
    const { speak } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');

    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(speakCalls[0].text).toBe('你好');
    expect(speakCalls[0].voice?.lang).toBe('zh-CN');
  });

  it('cancels current or queued speech before speaking new text', async () => {
    const { speak } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
    expect(speechSynthesis.cancel.mock.invocationCallOrder[0]).toBeLessThan(
      speechSynthesis.speak.mock.invocationCallOrder[0],
    );
  });

  it('tracks active speaking text and returns to idle after onend', async () => {
    const { getTtsState, speak } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    expect(getTtsState()).toEqual({ status: 'idle' });
    speak('你好');
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
    speakCalls[0].onend?.({} as SpeechSynthesisEvent);
    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('tracks speaking to idle after stop', async () => {
    const { getTtsState, speak, stop } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
    stop();
    expect(getTtsState()).toEqual({ status: 'idle' });
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(2);
  });

  it('notifies subscribers and stops notifying after unsubscribe', async () => {
    const { speak, stop, subscribeTts } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);
    const listener = vi.fn();

    const unsubscribe = subscribeTts(listener);
    speak('你好');

    expect(listener).toHaveBeenLastCalledWith({ status: 'speaking', text: '你好' });

    listener.mockClear();
    unsubscribe();
    stop();

    expect(listener).not.toHaveBeenCalled();
  });
});
