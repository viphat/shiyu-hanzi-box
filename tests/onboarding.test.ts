import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  getOnboardingSeen,
  markOnboardingSeen,
  onboardingSeenStorage,
} from '../lib/onboarding';

describe('onboarding storage', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('defaults to not-seen', async () => {
    expect(await getOnboardingSeen()).toBe(false);
  });

  it('marks onboarding as seen', async () => {
    await markOnboardingSeen();
    expect(await getOnboardingSeen()).toBe(true);
    expect(await onboardingSeenStorage.getValue()).toBe(true);
  });
});
