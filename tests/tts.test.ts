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

function createMockVoice(
  lang: string,
  name: string,
  options: { isDefault?: boolean; localService?: boolean } = {},
): SpeechSynthesisVoice {
  return {
    default: options.isDefault ?? false,
    lang,
    localService: options.localService ?? true,
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

type MockChromeTtsVoice = {
  lang?: string;
  voiceName?: string;
  remote?: boolean;
};

type MockChromeTts = {
  getVoices: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

let mockVoices: SpeechSynthesisVoice[] = [];
let speakCalls: MockSpeechSynthesisUtterance[] = [];
let voiceListeners: Array<() => void> = [];
let chromeSpeakOptions: Array<{
  lang?: string;
  voiceName?: string;
  onEvent?: (event: { type: string; errorMessage?: string }) => void;
}> = [];

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

function createMockChromeTts(voices: MockChromeTtsVoice[]): MockChromeTts {
  chromeSpeakOptions = [];

  return {
    getVoices: vi.fn((callback?: (voices: MockChromeTtsVoice[]) => void) => {
      callback?.(voices);
      return undefined;
    }),
    speak: vi.fn((_text: string, options?: { onEvent?: (event: { type: string }) => void }) => {
      chromeSpeakOptions.push(options ?? {});
    }),
    stop: vi.fn(),
  };
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

  it('detects a zh-CN voice without speaking before a user click', async () => {
    mockVoices = [createMockVoice('zh-CN', 'Google Mandarin')];
    const { initTts, isChineseVoiceAvailable } = await importTts();

    initTts();
    initTts();

    expect(isChineseVoiceAvailable()).toBe(true);
    expect(speechSynthesis.addEventListener).toHaveBeenCalledTimes(1);
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(speechSynthesis.cancel).not.toHaveBeenCalled();
  });

  it('detects voices when Chrome resolves them later', async () => {
    const { getTtsState, initTts, isChineseVoiceAvailable } = await importTts();

    initTts();
    mockVoices = [createMockVoice('zh-CN', 'Google Mandarin')];
    emitVoicesChanged();

    expect(isChineseVoiceAvailable()).toBe(true);
    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('detects a zh-CN chrome tts voice', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Ting-Ting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { getTtsState, initTts, isChineseVoiceAvailable } = await importTts();

    initTts();

    expect(chromeTts.getVoices).toHaveBeenCalled();
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

  it('prefers chrome tts speech when available', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Ting-Ting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { getTtsState, initTts, speak } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Google Mandarin')];
    initTts();
    speechSynthesis.speak.mockClear();
    speechSynthesis.cancel.mockClear();
    speakCalls = [];

    speak('你好');

    expect(chromeTts.speak).toHaveBeenCalledWith(
      '你好',
      expect.objectContaining({ lang: 'zh-CN', voiceName: 'Ting-Ting' }),
    );
    expect(speechSynthesis.speak).not.toHaveBeenCalled();
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
    chromeSpeakOptions[0].onEvent?.({ type: 'end' });
    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('stops chrome tts speech', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Ting-Ting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { getTtsState, initTts, speak, stop } = await importTts();

    initTts();
    speak('你好');
    stop();

    expect(chromeTts.stop).toHaveBeenCalledTimes(1);
    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('does not cancel before first idle speech', async () => {
    const { speak } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');

    expect(speechSynthesis.cancel).not.toHaveBeenCalled();
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
  });

  it('cancels active speech before replacing it with new text', async () => {
    const { speak } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');
    speechSynthesis.cancel.mockClear();
    speechSynthesis.speak.mockClear();

    speak('世界');

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

  it('ignores stale end callbacks from replaced speech', async () => {
    const { getTtsState, speak } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');
    const firstUtterance = speakCalls[0];

    speak('世界');

    expect(getTtsState()).toEqual({ status: 'speaking', text: '世界' });
    firstUtterance.onend?.({} as SpeechSynthesisEvent);
    expect(getTtsState()).toEqual({ status: 'speaking', text: '世界' });
    speakCalls[1].onend?.({} as SpeechSynthesisEvent);
    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('tracks speaking to idle after stop', async () => {
    const { getTtsState, speak, stop } = await initWithVoices([createMockVoice('zh-CN', 'Google Mandarin')]);

    speak('你好');
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
    stop();
    expect(getTtsState()).toEqual({ status: 'idle' });
    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
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

  it('picks Tingting over the novelty voice Chrome lists first', async () => {
    const { speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Tingting');
  });

  it('reports unavailable when only novelty voices exist', async () => {
    const { isChineseVoiceAvailable } = await initWithVoices([
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
    ]);

    expect(isChineseVoiceAvailable()).toBe(false);
  });

  it('uses the configured voice name', async () => {
    const { configureTts, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-TW', 'Meijia'),
    ]);

    configureTts({ voiceName: 'Meijia', rate: 1, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Meijia');
  });

  it('keeps a saved voice name that is not installed and falls back', async () => {
    const { configureTts, getSelectedVoiceName, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    configureTts({ voiceName: 'Removed Voice', rate: 1, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Tingting');
    expect(getSelectedVoiceName()).toBe('Tingting');
  });

  it('clamps an out-of-range rate before it reaches the utterance', async () => {
    // configureTts is the module's only settings entry point; the [0.5, 1.5]
    // clamp is a binding constraint that must hold here too, not only in
    // normalizeSettings before storage.
    const { configureTts, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    configureTts({ voiceName: null, rate: 9, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].rate).toBe(1.5);
  });

  it('applies the configured rate to Web Speech', async () => {
    const { configureTts, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    configureTts({ voiceName: null, rate: 0.7, allowNetworkVoices: false });
    speak('你好');

    expect(speakCalls[0].rate).toBe(0.7);
  });

  it('applies the configured rate to chrome tts', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, speak } = await importTts();

    initTts();
    configureTts({ voiceName: null, rate: 0.6, allowNetworkVoices: false });
    speak('你好');

    expect(chromeTts.speak).toHaveBeenCalledWith(
      '你好',
      expect.objectContaining({ rate: 0.6 }),
    );
  });

  it('routes to Web Speech for a voice chrome tts does not have', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, speak } = await importTts();

    mockVoices = [
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-CN', 'Web Only Voice'),
    ];
    initTts();
    speakCalls = [];

    configureTts({ voiceName: 'Web Only Voice', rate: 1, allowNetworkVoices: false });
    speak('你好');

    expect(chromeTts.speak).not.toHaveBeenCalled();
    expect(speakCalls[0].voice?.name).toBe('Web Only Voice');
  });

  it('ignores remote voices until network voices are allowed', async () => {
    const { configureTts, isChineseVoiceAvailable } = await initWithVoices([
      createMockVoice('zh-CN', 'Google 普通话', { localService: false }),
    ]);

    expect(isChineseVoiceAvailable()).toBe(false);

    configureTts({ voiceName: null, rate: 1, allowNetworkVoices: true });

    expect(isChineseVoiceAvailable()).toBe(true);
  });

  it('lists Chinese voices for the picker, including ones never auto-selected', async () => {
    const { listVoiceCandidates } = await initWithVoices([
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('en-US', 'Samantha'),
    ]);

    expect(listVoiceCandidates().map((voice) => voice.name)).toEqual([
      'Tingting',
      'Eddy (Chinese (China mainland))',
    ]);
  });

  it('merges a voice present in both engines into one candidate', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { initTts, listVoiceCandidates } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Tingting', { isDefault: true })];
    initTts();

    const candidates = listVoiceCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].engines).toEqual(expect.arrayContaining(['web', 'chrome']));
    expect(candidates[0].isDefault).toBe(true);
  });

  it('stops chrome tts when the resolved voice moves to a web-only engine', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, speak } = await importTts();

    mockVoices = [
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-CN', 'Web Only Voice'),
    ];
    initTts();
    speak('你好');
    expect(chromeTts.speak).toHaveBeenCalledTimes(1);
    chromeTts.stop.mockClear();

    configureTts({ voiceName: 'Web Only Voice', rate: 1, allowNetworkVoices: false });
    speak('世界');

    expect(chromeTts.stop).toHaveBeenCalledTimes(1);
    expect(speakCalls[0].text).toBe('世界');
  });

  it('merges a voice the two engines spell differently (Web Speech language-suffixed, chrome bare) into one candidate', async () => {
    // Web Speech disambiguates a name that exists in more than one locale by
    // appending the language; chrome.tts reports the bare name for the same
    // physical voice. Keying the merge on exact name (the old behaviour)
    // would list this voice twice.
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Eddy' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { initTts, listVoiceCandidates } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))')];
    initTts();

    const candidates = listVoiceCandidates();

    expect(candidates).toHaveLength(1);
    expect(candidates[0].engines).toEqual(expect.arrayContaining(['web', 'chrome']));
    // The Web Speech spelling is the display identity: it carries the
    // language, which is genuinely more informative to the user.
    expect(candidates[0].name).toBe('Eddy (Chinese (China mainland))');
  });

  it('speaks a merged voice by passing each engine its own spelling', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Eddy' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, speak } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))')];
    initTts();

    configureTts({
      voiceName: 'Eddy (Chinese (China mainland))',
      rate: 1,
      allowNetworkVoices: false,
    });
    speak('你好');

    // chrome.tts is preferred when the resolved voice supports it, and it
    // must receive the bare chrome spelling, not the Web Speech display name.
    expect(chromeTts.speak).toHaveBeenCalledWith(
      '你好',
      expect.objectContaining({ voiceName: 'Eddy' }),
    );
  });

  it('treats a voice as remote when only chrome.tts reports it as remote, gating it off by default', async () => {
    // The defensive OR-merge of isRemote across engines only fires once the
    // two engines' spellings of one voice are actually recognized as the
    // same candidate. This is the security-relevant half of the fix: a voice
    // Web Speech calls local must not escape the network-voices gate under
    // its web-side name while chrome.tts calls the same physical voice remote.
    const chromeTts = createMockChromeTts([
      { lang: 'zh-CN', voiceName: 'Eddy', remote: true },
    ]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { configureTts, initTts, isChineseVoiceAvailable, listVoiceCandidates } =
      await importTts();

    mockVoices = [
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))', { localService: true }),
    ];
    initTts();

    const candidates = listVoiceCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isRemote).toBe(true);

    // Eddy is also an Eloquence voice and thus never auto-selected on its
    // own merits, so pin the choice explicitly to isolate the remote gate.
    configureTts({
      voiceName: 'Eddy (Chinese (China mainland))',
      rate: 1,
      allowNetworkVoices: false,
    });
    expect(isChineseVoiceAvailable()).toBe(false);

    configureTts({
      voiceName: 'Eddy (Chinese (China mainland))',
      rate: 1,
      allowNetworkVoices: true,
    });
    expect(isChineseVoiceAvailable()).toBe(true);
  });

  it('notifies subscribers with a fresh state object when voices resolve later while idle', async () => {
    // Regression test: chrome.tts resolves voices asynchronously, often after
    // speechSynthesis has already settled the module into 'idle'. If
    // updateAvailableState() re-notifies with the *same* state reference,
    // React subscribers (setTtsState(state)) bail out under Object.is and the
    // picker never learns about the newly-arrived voice.
    mockVoices = [createMockVoice('zh-CN', 'Tingting')];
    const { getTtsState, initTts, subscribeTts } = await importTts();

    initTts();
    const initialState = getTtsState();
    expect(initialState).toEqual({ status: 'idle' });

    const listener = vi.fn();
    subscribeTts(listener);

    // A second voice arrives late (e.g. a network voice resolved by chrome.tts).
    mockVoices = [
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-CN', 'Meijia'),
    ];
    emitVoicesChanged();

    expect(listener).toHaveBeenCalled();
    const receivedState = listener.mock.calls[listener.mock.calls.length - 1][0];
    expect(receivedState).toEqual({ status: 'idle' });
    expect(receivedState).not.toBe(initialState);
  });

  it('cancels web speech when allowNetworkVoices is turned off mid-speech', async () => {
    // A local voice must also exist here, so `selected` falls back to it
    // instead of becoming null — otherwise this test would pass by accident
    // via the `!selected` unavailable path instead of exercising the
    // eligibility check that actually guards a still-speaking remote voice.
    const { configureTts, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Google 普通话', { localService: false }),
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    configureTts({ voiceName: 'Google 普通话', rate: 1, allowNetworkVoices: true });
    speak('你好');
    expect(speechSynthesis.speak).toHaveBeenCalledTimes(1);
    expect(speakCalls[0].voice?.name).toBe('Google 普通话');
    speechSynthesis.cancel.mockClear();

    configureTts({ voiceName: 'Google 普通话', rate: 1, allowNetworkVoices: false });

    expect(speechSynthesis.cancel).toHaveBeenCalledTimes(1);
  });

  it('keeps two web voices sharing a merge key but with different full names as separate candidates', async () => {
    // "Foo (Male)" and "Foo (Female)" share a stripped-suffix merge key
    // ("Foo zh-cn") but are genuinely distinct voices. voiceMergeKey is only
    // ever a pairing hint, not an identity — the exact `name` must remain
    // the identity for web voices, so both must survive.
    const { listVoiceCandidates } = await initWithVoices([
      createMockVoice('zh-CN', 'Foo (Male)'),
      createMockVoice('zh-CN', 'Foo (Female)'),
    ]);

    const names = listVoiceCandidates()
      .map((voice) => voice.name)
      .sort();
    expect(names).toEqual(['Foo (Female)', 'Foo (Male)']);
  });

  it('does not pair a chrome voice when its merge key is ambiguous across two web voices', async () => {
    // The chrome voice "Foo" collapses to the same key as both "Foo (Male)"
    // and "Foo (Female)". Since the hint cannot tell which one it physically
    // is, it must not silently merge into either — it becomes its own
    // candidate instead, and the two web voices must stay untouched.
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Foo' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { initTts, listVoiceCandidates } = await importTts();

    mockVoices = [
      createMockVoice('zh-CN', 'Foo (Male)'),
      createMockVoice('zh-CN', 'Foo (Female)'),
    ];
    initTts();

    const candidates = listVoiceCandidates();
    expect(candidates).toHaveLength(3);

    const male = candidates.find((c) => c.name === 'Foo (Male)')!;
    const female = candidates.find((c) => c.name === 'Foo (Female)')!;
    const chromeOnly = candidates.find((c) => c.name === 'Foo')!;

    expect(male.engines).toEqual(['web']);
    expect(female.engines).toEqual(['web']);
    expect(chromeOnly).toBeDefined();
    expect(chromeOnly.engines).toEqual(['chrome']);
  });

  it('keeps a second chrome voice standing alone rather than re-pairing it onto an already-paired candidate', async () => {
    // Two chrome.tts voices ("Eddy" and "Eddy (Extra)") both resolve, via
    // the stripped-suffix merge key, to the same single web candidate
    // ("Eddy (Chinese (China mainland))"). The first pairs normally. The
    // second must not silently overwrite the already-set chrome spelling
    // (which would point chrome.tts.speak at the wrong physical voice) —
    // it must become its own standalone candidate instead, and neither
    // voice may be dropped.
    const chromeTts = createMockChromeTts([
      { lang: 'zh-CN', voiceName: 'Eddy' },
      { lang: 'zh-CN', voiceName: 'Eddy (Extra)' },
    ]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { initTts, listVoiceCandidates } = await importTts();

    mockVoices = [
      createMockVoice('zh-CN', 'Eddy (Chinese (China mainland))'),
    ];
    initTts();

    const candidates = listVoiceCandidates();
    expect(candidates).toHaveLength(2);

    const paired = candidates.find((c) => c.name === 'Eddy (Chinese (China mainland))')!;
    const standalone = candidates.find((c) => c.name === 'Eddy (Extra)')!;

    expect(paired).toBeDefined();
    expect(paired.engines).toEqual(expect.arrayContaining(['web', 'chrome']));
    expect(paired.engineNames.chrome).toBe('Eddy');

    expect(standalone).toBeDefined();
    expect(standalone.engines).toEqual(['chrome']);
    expect(standalone.engineNames.chrome).toBe('Eddy (Extra)');
  });

  it('surfaces a Web Speech synthesis failure instead of returning to idle', async () => {
    const { getTtsState, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');
    speakCalls[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);

    expect(getTtsState()).toEqual({ status: 'error', text: '你好' });
  });

  it('treats a cancelled Web Speech utterance as a normal stop, not a failure', async () => {
    // Web Speech reports deliberate cancellation through onerror rather than
    // onend — unlike chrome.tts, which gives it a distinct event type. A user
    // pressing stop must not be shown a failure.
    const { getTtsState, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');
    speakCalls[0].onerror?.({ error: 'canceled' } as SpeechSynthesisErrorEvent);

    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('treats an interrupted Web Speech utterance as a normal stop', async () => {
    const { getTtsState, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');
    speakCalls[0].onerror?.({ error: 'interrupted' } as SpeechSynthesisErrorEvent);

    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('surfaces a chrome.tts synthesis failure', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { getTtsState, initTts, speak } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Tingting')];
    initTts();
    speak('你好');
    chromeSpeakOptions[0].onEvent?.({ type: 'error', errorMessage: 'engine died' });

    expect(getTtsState()).toEqual({ status: 'error', text: '你好' });
  });

  it('keeps chrome.tts interruption and cancellation out of the error state', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: chromeTts });
    const { getTtsState, initTts, speak } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Tingting')];
    initTts();
    speak('你好');
    chromeSpeakOptions[0].onEvent?.({ type: 'interrupted' });

    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('clears the error state on the next utterance', async () => {
    const { getTtsState, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');
    speakCalls[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);
    expect(getTtsState()).toEqual({ status: 'error', text: '你好' });

    speak('世界');

    expect(getTtsState()).toEqual({ status: 'speaking', text: '世界' });
  });

  it('clears the error state on stop', async () => {
    const { getTtsState, speak, stop } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');
    speakCalls[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);
    stop();

    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('clears the error state when the voice list changes', async () => {
    const { getTtsState, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    speak('你好');
    speakCalls[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);

    mockVoices = [
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-CN', 'Meijia'),
    ];
    emitVoicesChanged();

    expect(getTtsState()).toEqual({ status: 'idle' });
  });

  it('notifies subscribers when an utterance fails', async () => {
    const { speak, subscribeTts } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);
    const states: unknown[] = [];
    subscribeTts((next) => states.push(next));

    speak('你好');
    speakCalls[0].onerror?.({ error: 'synthesis-failed' } as SpeechSynthesisErrorEvent);

    expect(states).toContainEqual({ status: 'error', text: '你好' });
  });

  it('drops a chrome-only voice when chrome.tts cannot speak', async () => {
    // A chrome-only candidate has no Web Speech spelling, so if chrome.tts
    // exposes getVoices but not speak, nothing can pronounce it: the old
    // behaviour reported the voice as available, rendered the button, and
    // then silently did nothing on click.
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Extension Voice' }]);
    vi.stubGlobal('chrome', { tts: { ...chromeTts, speak: undefined } });
    const { initTts, isChineseVoiceAvailable, listVoiceCandidates } = await importTts();

    mockVoices = [];
    initTts();

    expect(listVoiceCandidates()).toEqual([]);
    expect(isChineseVoiceAvailable()).toBe(false);
  });

  it('keeps a voice both engines share when chrome.tts cannot speak', async () => {
    // The mirror of the case above: this voice still has a Web Speech
    // spelling, so it stays usable and must not be filtered out with the
    // chrome-only ones. The chrome list is still worth merging even when
    // speak is missing — it is what supplies `remote` for the network gate.
    const chromeTts = createMockChromeTts([
      { lang: 'zh-CN', voiceName: 'Tingting', remote: true },
    ]);
    vi.stubGlobal('chrome', { tts: { ...chromeTts, speak: undefined } });
    const { initTts, isChineseVoiceAvailable, listVoiceCandidates } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Tingting', { localService: true })];
    initTts();

    const candidates = listVoiceCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].isRemote).toBe(true);
    // Remote, and the gate is off by default — so nothing is selectable, but
    // for the network reason rather than because the candidate vanished.
    expect(isChineseVoiceAvailable()).toBe(false);
  });

  it('speaks a shared voice through Web Speech when chrome.tts cannot speak', async () => {
    const chromeTts = createMockChromeTts([{ lang: 'zh-CN', voiceName: 'Tingting' }]);
    vi.stubGlobal('chrome', { tts: { ...chromeTts, speak: undefined } });
    const { getTtsState, initTts, speak } = await importTts();

    mockVoices = [createMockVoice('zh-CN', 'Tingting')];
    initTts();
    speak('你好');

    expect(speakCalls[0].voice?.name).toBe('Tingting');
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
  });

  it('does not cancel mid-utterance merely because a better voice arrived', async () => {
    // Being out-ranked by a newly-arrived voice is not a reason to interrupt
    // audio already playing — only losing eligibility (voice removed, or its
    // network-voice consent revoked) should cancel.
    const { configureTts, getTtsState, speak } = await initWithVoices([
      createMockVoice('zh-CN', 'Tingting'),
    ]);

    // Auto-select, so `selected` is free to move to a better-ranked voice.
    configureTts({ voiceName: null, rate: 1, allowNetworkVoices: false });
    speak('你好');
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
    expect(speakCalls[0].voice?.name).toBe('Tingting');
    speechSynthesis.cancel.mockClear();

    // A higher-ranked local voice (Premium) shows up mid-utterance via a late
    // voiceschanged event. Tingting is still installed and still eligible —
    // it is merely no longer the top pick.
    mockVoices = [
      createMockVoice('zh-CN', 'Tingting'),
      createMockVoice('zh-CN', 'Premium Voice'),
    ];
    emitVoicesChanged();

    expect(speechSynthesis.cancel).not.toHaveBeenCalled();
    expect(getTtsState()).toEqual({ status: 'speaking', text: '你好' });
  });
});
