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
    provider: 'custom',
    baseUrl: '',
    model: '',
    label: 'Custom endpoint',
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

export async function getAiSettings(): Promise<AiSettings> {
  return aiSettingsStorage.getValue();
}

export async function setAiSettings(next: AiSettings): Promise<void> {
  await aiSettingsStorage.setValue(next);
}
