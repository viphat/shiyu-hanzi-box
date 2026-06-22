import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  originFromBaseUrl,
  requestAiSettingsPermission,
  requestProviderPermission,
} from '../lib/ai/permissions';
import type { AiSettings } from '../lib/types';

const { request, contains } = vi.hoisted(() => ({
  request: vi.fn(),
  contains: vi.fn(),
}));

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: {
      request,
      contains,
    },
  },
}));

const settings = (over: Partial<AiSettings> = {}): AiSettings => ({
  enabled: true,
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  apiKey: 'sk-test',
  model: 'deepseek-chat',
  ...over,
});

describe('originFromBaseUrl', () => {
  it('turns a base URL into a Chrome origin pattern', () => {
    expect(originFromBaseUrl('https://api.deepseek.com/v1')).toBe(
      'https://api.deepseek.com/*',
    );
  });

  it('returns null for invalid URLs', () => {
    expect(originFromBaseUrl('not a url')).toBeNull();
  });
});

describe('requestProviderPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue(true);
  });

  it('requests the known provider origin', async () => {
    await requestProviderPermission('deepseek');
    expect(request).toHaveBeenCalledWith({
      origins: ['https://api.deepseek.com/*'],
    });
  });

  it('requests a custom origin when supplied', async () => {
    await requestProviderPermission('custom', 'http://localhost:11434/*');
    expect(request).toHaveBeenCalledWith({
      origins: ['http://localhost:11434/*'],
    });
  });
});

describe('requestAiSettingsPermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    request.mockResolvedValue(true);
  });

  it('does nothing when AI is disabled', async () => {
    const ok = await requestAiSettingsPermission(settings({ enabled: false }));

    expect(ok).toBe(true);
    expect(request).not.toHaveBeenCalled();
  });

  it('requests custom endpoint origin when AI is enabled', async () => {
    await requestAiSettingsPermission(
      settings({
        provider: 'custom',
        baseUrl: 'http://localhost:11434/v1',
      }),
    );

    expect(request).toHaveBeenCalledWith({
      origins: ['http://localhost:11434/*'],
    });
  });
});
