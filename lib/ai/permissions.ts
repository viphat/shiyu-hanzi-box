import { browser } from 'wxt/browser';
import type { AiProvider, AiSettings } from '../types';
import { getProviderOrigins } from './settings';

export async function requestProviderPermission(provider: AiProvider): Promise<boolean> {
  const origins = getProviderOrigins(provider);
  if (origins.length === 0) return false;

  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

export async function requestAiSettingsPermission(settings: AiSettings): Promise<boolean> {
  if (!settings.enabled) return true;
  return requestProviderPermission(settings.provider);
}

export async function hasProviderPermission(provider: AiProvider): Promise<boolean> {
  const origins = getProviderOrigins(provider);
  if (origins.length === 0) return true;

  try {
    return await browser.permissions.contains({ origins });
  } catch {
    return false;
  }
}
