import { browser } from 'wxt/browser';
import type { AiProvider, AiSettings } from '../types';
import { getProviderOrigins } from './settings';

export function originFromBaseUrl(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') return null;
    return `${url.origin}/*`;
  } catch {
    return null;
  }
}

export async function requestProviderPermission(
  provider: AiProvider,
  customOrigin?: string,
): Promise<boolean> {
  const origins = customOrigin ? [customOrigin] : getProviderOrigins(provider);
  if (origins.length === 0) return false;

  try {
    return await browser.permissions.request({ origins });
  } catch {
    return false;
  }
}

export async function requestAiSettingsPermission(settings: AiSettings): Promise<boolean> {
  if (!settings.enabled) return true;
  const customOrigin =
    settings.provider === 'custom'
      ? originFromBaseUrl(settings.baseUrl) ?? undefined
      : undefined;
  return requestProviderPermission(settings.provider, customOrigin);
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
