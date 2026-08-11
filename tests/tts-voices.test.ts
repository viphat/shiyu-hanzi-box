import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TTS_SETTINGS,
  clampTtsRate,
  isEloquenceVoice,
  listChineseVoices,
  rankVoices,
  selectVoice,
  type VoiceCandidate,
} from '../lib/tts-voices';

function candidate(overrides: Partial<VoiceCandidate> & { name: string }): VoiceCandidate {
  return {
    lang: 'zh-CN',
    isRemote: false,
    isDefault: false,
    engines: ['web'],
    index: 0,
    ...overrides,
  };
}

describe('isEloquenceVoice', () => {
  it('matches the bare chrome.tts spelling', () => {
    expect(isEloquenceVoice('Eddy')).toBe(true);
  });

  it('matches the Web Speech spelling with the language suffix', () => {
    expect(isEloquenceVoice('Eddy (Chinese (China mainland))')).toBe(true);
    expect(isEloquenceVoice('Grandma (Chinese (Taiwan))')).toBe(true);
  });

  it('does not match real voices', () => {
    expect(isEloquenceVoice('Tingting')).toBe(false);
    expect(isEloquenceVoice('Meijia')).toBe(false);
  });
});

describe('rankVoices', () => {
  it('ranks Tingting above Eddy — the reported defect', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Tingting', index: 17 }),
    ];

    const ranked = rankVoices(voices, false);

    expect(ranked[0].name).toBe('Tingting');
  });

  it('excludes every Eloquence voice from auto-selection', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Shelley', index: 1 }),
    ];

    expect(rankVoices(voices, false)).toEqual([]);
  });

  it('drops non-Chinese voices', () => {
    const voices = [
      candidate({ name: 'Samantha', lang: 'en-US', index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    const ranked = rankVoices(voices, false);

    expect(ranked).toHaveLength(1);
    expect(ranked[0].name).toBe('Tingting');
  });

  it('lets the OS default voice beat a higher-scoring non-default voice', () => {
    const voices = [
      candidate({ name: 'Tingting', index: 0 }),
      candidate({ name: 'Meijia', lang: 'zh-TW', isDefault: true, index: 1 }),
    ];

    expect(rankVoices(voices, false)[0].name).toBe('Meijia');
  });

  it('keeps the OS default ahead of a voice stacking every other bonus', () => {
    const voices = [
      candidate({
        name: 'Xiaoxiao Premium Neural',
        lang: 'zh-CN',
        isRemote: true,
        index: 0,
      }),
      candidate({ name: 'Meijia', lang: 'zh-TW', isDefault: true, index: 1 }),
    ];

    expect(rankVoices(voices, true)[0].name).toBe('Meijia');
  });

  it('scores the zh-CN bonus regardless of tag casing', () => {
    const voices = [
      candidate({ name: 'Lowercase Tag', lang: 'zh-cn', index: 0 }),
      candidate({ name: 'Other Region', lang: 'zh-TW', index: 1 }),
    ];

    expect(rankVoices(voices, false)[0].name).toBe('Lowercase Tag');
  });

  it('never auto-selects an Eloquence voice even when it is the OS default', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', isDefault: true, index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    expect(rankVoices(voices, false)[0].name).toBe('Tingting');
  });

  it('excludes remote voices unless network voices are allowed', () => {
    const voices = [candidate({ name: 'Google 普通话', isRemote: true, index: 0 })];

    expect(rankVoices(voices, false)).toEqual([]);
    expect(rankVoices(voices, true)[0].name).toBe('Google 普通话');
  });

  it('breaks equal scores toward the lower source index', () => {
    const voices = [
      candidate({ name: 'Voice B', index: 5 }),
      candidate({ name: 'Voice A', index: 2 }),
    ];

    expect(rankVoices(voices, false).map((v) => v.name)).toEqual(['Voice A', 'Voice B']);
  });
});

describe('selectVoice', () => {
  it('honours an explicit voice name over the ranking', () => {
    const voices = [
      candidate({ name: 'Tingting', index: 0 }),
      candidate({ name: 'Meijia', lang: 'zh-TW', index: 1 }),
    ];

    const chosen = selectVoice(voices, { ...DEFAULT_TTS_SETTINGS, voiceName: 'Meijia' });

    expect(chosen?.name).toBe('Meijia');
  });

  it('honours an explicitly chosen Eloquence voice', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    const chosen = selectVoice(voices, {
      ...DEFAULT_TTS_SETTINGS,
      voiceName: 'Eddy (Chinese (China mainland))',
    });

    expect(chosen?.name).toBe('Eddy (Chinese (China mainland))');
  });

  it('ignores an explicit remote voice when network voices are off', () => {
    const voices = [
      candidate({ name: 'Google 普通话', isRemote: true, index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
    ];

    const chosen = selectVoice(voices, {
      ...DEFAULT_TTS_SETTINGS,
      voiceName: 'Google 普通话',
    });

    expect(chosen?.name).toBe('Tingting');
  });

  it('falls back to the ranking when the saved voice is gone', () => {
    const voices = [candidate({ name: 'Tingting', index: 0 })];

    const chosen = selectVoice(voices, { ...DEFAULT_TTS_SETTINGS, voiceName: 'Removed Voice' });

    expect(chosen?.name).toBe('Tingting');
  });

  it('returns null when nothing is eligible', () => {
    expect(selectVoice([], DEFAULT_TTS_SETTINGS)).toBeNull();
  });
});

describe('listChineseVoices', () => {
  it('keeps Eloquence and remote voices for the picker but sinks them', () => {
    const voices = [
      candidate({ name: 'Eddy (Chinese (China mainland))', index: 0 }),
      candidate({ name: 'Tingting', index: 1 }),
      candidate({ name: 'Samantha', lang: 'en-US', index: 2 }),
    ];

    const listed = listChineseVoices(voices);

    expect(listed.map((v) => v.name)).toEqual([
      'Tingting',
      'Eddy (Chinese (China mainland))',
    ]);
  });
});

describe('clampTtsRate', () => {
  it('clamps below the floor and above the ceiling', () => {
    expect(clampTtsRate(0.1)).toBe(0.5);
    expect(clampTtsRate(9)).toBe(1.5);
  });

  it('passes valid rates through and falls back for non-numbers', () => {
    expect(clampTtsRate(1.2)).toBe(1.2);
    expect(clampTtsRate(Number.NaN)).toBe(1);
  });
});
