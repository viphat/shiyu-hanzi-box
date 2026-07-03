import { storage } from 'wxt/utils/storage';

export const onboardingSeenStorage = storage.defineItem<boolean>('local:onboardingSeen', {
  fallback: false,
});

export async function getOnboardingSeen(): Promise<boolean> {
  return onboardingSeenStorage.getValue();
}

export async function markOnboardingSeen(): Promise<void> {
  await onboardingSeenStorage.setValue(true);
}
