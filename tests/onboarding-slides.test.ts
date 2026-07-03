import { describe, expect, it } from 'vitest';
import { ONBOARDING_SLIDES } from '../entrypoints/dashboard/components/onboarding/slides';
import { messages } from '../lib/i18n';

describe('onboarding slides', () => {
  it('has six slides with the first as an illustration (no image)', () => {
    expect(ONBOARDING_SLIDES).toHaveLength(6);
    expect(ONBOARDING_SLIDES[0].image).toBeUndefined();
    expect(ONBOARDING_SLIDES.slice(1).every((s) => typeof s.image === 'string')).toBe(true);
  });

  it('uses keys present in both en and zh-CN', () => {
    for (const slide of ONBOARDING_SLIDES) {
      for (const key of [slide.titleKey, slide.bodyKey]) {
        expect(messages.en[key]).toBeTruthy();
        expect(messages['zh-CN'][key as keyof typeof messages['zh-CN']]).toBeTruthy();
      }
    }
  });
});
