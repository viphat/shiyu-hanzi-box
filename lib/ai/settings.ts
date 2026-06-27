import { storage } from 'wxt/utils/storage';
import type { AiProvider, AiSettings } from '../types';

export const DEFAULT_SETTINGS: AiSettings = {
  enabled: false,
  provider: 'deepseek',
  baseUrl: '',
  apiKey: '',
  model: '',
};

export const DEFAULT_AI_SETTINGS = DEFAULT_SETTINGS;

export const PROVIDER_PRESETS: Array<{
  provider: AiProvider;
  baseUrl: string;
  model: string;
  label: string;
}> = [
  {
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    label: 'DeepSeek',
  },
  {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    label: 'OpenAI',
  },
  {
    provider: 'openrouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'openai/gpt-4o-mini',
    label: 'OpenRouter',
  },
  {
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-2.5-flash',
    label: 'Google Gemini',
  },
  {
    provider: 'qwen',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    label: '通义千问 Qwen',
  },
  {
    provider: 'moonshot',
    baseUrl: 'https://api.moonshot.cn/v1',
    model: 'moonshot-v1-8k',
    label: 'Moonshot Kimi',
  },
  {
    provider: 'zhipu',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    label: '智谱 GLM',
  },
];

export const aiSettingsStorage = storage.defineItem<AiSettings>('local:aiSettings', {
  fallback: DEFAULT_SETTINGS,
});

export function applyPreset(settings: AiSettings, provider: AiProvider): AiSettings {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.provider === provider);
  if (!preset) return settings;
  return {
    ...settings,
    provider,
    baseUrl: preset.baseUrl,
    model: preset.model,
  };
}

export function getProviderOrigins(provider: AiProvider): string[] {
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.provider === provider);
  if (!preset || preset.baseUrl === '') return [];
  try {
    const url = new URL(preset.baseUrl);
    return [`${url.origin}/*`];
  } catch {
    return [];
  }
}

export function setAiApiKey(settings: AiSettings, apiKey: string): AiSettings {
  return {
    ...settings,
    apiKey: apiKey.trim(),
  };
}

export function isAiConfigured(settings: AiSettings): boolean {
  return (
    settings.enabled &&
    settings.apiKey.trim() !== '' &&
    settings.baseUrl.trim() !== '' &&
    settings.model.trim() !== ''
  );
}

export async function getAiSettings(): Promise<AiSettings> {
  return aiSettingsStorage.getValue();
}

export async function setAiSettings(next: AiSettings): Promise<void> {
  await aiSettingsStorage.setValue(next);
}
