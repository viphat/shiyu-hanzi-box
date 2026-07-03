import screenshotCapture from '@/assets/screenshots/screenshot-4.png';
import screenshotWord from '@/assets/screenshots/screenshot-2.png';
import screenshotCloze from '@/assets/screenshots/screenshot-3.png';
import screenshotDashboard from '@/assets/screenshots/screenshot-1.png';
import type { MessageKey } from '@/lib/i18n';

export interface OnboardingSlide {
  titleKey: MessageKey;
  bodyKey: MessageKey;
  /** Screenshot URL; omitted for the intro illustration slide. */
  image?: string;
}

export const ONBOARDING_SLIDES: OnboardingSlide[] = [
  { titleKey: 'onboarding.welcome.title', bodyKey: 'onboarding.welcome.body' },
  { titleKey: 'onboarding.capture.title', bodyKey: 'onboarding.capture.body', image: screenshotCapture },
  { titleKey: 'onboarding.word.title', bodyKey: 'onboarding.word.body', image: screenshotWord },
  { titleKey: 'onboarding.quotes.title', bodyKey: 'onboarding.quotes.body', image: screenshotCloze },
  { titleKey: 'onboarding.review.title', bodyKey: 'onboarding.review.body', image: screenshotDashboard },
  { titleKey: 'onboarding.export.title', bodyKey: 'onboarding.export.body', image: screenshotDashboard },
];
