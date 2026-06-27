import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
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

  it('requests the enumerated origin for a multi-model proxy provider', async () => {
    await requestProviderPermission('openrouter');
    expect(request).toHaveBeenCalledWith({
      origins: ['https://openrouter.ai/*'],
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

  it('requests the selected provider origin when AI is enabled', async () => {
    await requestAiSettingsPermission(settings({ provider: 'qwen' }));

    expect(request).toHaveBeenCalledWith({
      origins: ['https://dashscope.aliyuncs.com/*'],
    });
  });
});
