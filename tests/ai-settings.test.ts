import { describe, expect, it } from 'vitest';
import {
  applyPreset,
  DEFAULT_AI_SETTINGS,
  getProviderOrigins,
  PROVIDER_PRESETS,
  setAiApiKey,
} from '../lib/ai/settings';

describe('PROVIDER_PRESETS', () => {
  it('uses DeepSeek as the default preset', () => {
    expect(PROVIDER_PRESETS[0].provider).toBe('deepseek');
    expect(PROVIDER_PRESETS[0].baseUrl).toBe('https://api.deepseek.com');
    expect(PROVIDER_PRESETS[0].model).toBe('deepseek-v4-flash');
  });

  it('includes OpenAI with a host-permission origin', () => {
    const openai = PROVIDER_PRESETS.find((preset) => preset.provider === 'openai');

    expect(openai).toBeDefined();
    expect(openai!.baseUrl).toContain('openai.com');
    expect(getProviderOrigins('openai')).toEqual(['https://api.openai.com/*']);
  });

  it('enumerates a host-permission origin for every preset', () => {
    for (const preset of PROVIDER_PRESETS) {
      const origins = getProviderOrigins(preset.provider);
      expect(origins).toHaveLength(1);
      expect(origins[0]).toMatch(/^https:\/\/[^/]+\/\*$/);
    }
  });

  it('routes the multi-model proxy and Chinese providers to their origins', () => {
    expect(getProviderOrigins('openrouter')).toEqual(['https://openrouter.ai/*']);
    expect(getProviderOrigins('gemini')).toEqual([
      'https://generativelanguage.googleapis.com/*',
    ]);
    expect(getProviderOrigins('qwen')).toEqual(['https://dashscope.aliyuncs.com/*']);
    expect(getProviderOrigins('moonshot')).toEqual(['https://api.moonshot.cn/*']);
    expect(getProviderOrigins('zhipu')).toEqual(['https://open.bigmodel.cn/*']);
  });
});

describe('applyPreset', () => {
  it('fills baseUrl and model from the selected preset', () => {
    const settings = applyPreset(DEFAULT_AI_SETTINGS, 'deepseek');

    expect(settings.provider).toBe('deepseek');
    expect(settings.baseUrl).toBe(PROVIDER_PRESETS[0].baseUrl);
    expect(settings.model).toBe(PROVIDER_PRESETS[0].model);
  });

  it('preserves the API key and enabled flag', () => {
    const base = { ...DEFAULT_AI_SETTINGS, apiKey: 'sk-test', enabled: true };
    const settings = applyPreset(base, 'openai');

    expect(settings.apiKey).toBe('sk-test');
    expect(settings.enabled).toBe(true);
  });
});

describe('setAiApiKey', () => {
  it('stores a trimmed API key without changing provider settings', () => {
    const settings = setAiApiKey(
      { ...DEFAULT_AI_SETTINGS, provider: 'openai', baseUrl: 'https://api.openai.com/v1' },
      '  sk-test  ',
    );

    expect(settings.apiKey).toBe('sk-test');
    expect(settings.provider).toBe('openai');
    expect(settings.baseUrl).toBe('https://api.openai.com/v1');
  });
});
