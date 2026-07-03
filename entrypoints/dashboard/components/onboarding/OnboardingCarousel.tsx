// entrypoints/dashboard/components/onboarding/OnboardingCarousel.tsx
import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import iconUrl from '@/assets/icon.png';
import { Sprig } from '@/components/Foliage';
import { formatMessage, t } from '@/lib/i18n';
import type { UiLocale } from '@/lib/types';
import { ONBOARDING_SLIDES } from './slides';

export function OnboardingCarousel({
  locale,
  onClose,
}: {
  locale: UiLocale;
  onClose: () => void;
}) {
  const slides = ONBOARDING_SLIDES;
  const [index, setIndex] = useState(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const slide = slides[index];
  const isLast = index === slides.length - 1;
  const titleId = 'onboarding-title';

  function next() {
    if (isLast) onClose();
    else setIndex((i) => Math.min(i + 1, slides.length - 1));
  }

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose();
        return;
      }
      if (event.key === 'ArrowRight') {
        setIndex((i) => Math.min(i + 1, slides.length - 1));
        return;
      }
      if (event.key === 'ArrowLeft') {
        setIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === 'Tab' && dialogRef.current) {
        const nodes = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input, [tabindex]:not([tabindex="-1"])',
        );
        if (nodes.length === 0) {
          event.preventDefault();
          dialogRef.current.focus();
          return;
        }
        const first = nodes[0];
        const last = nodes[nodes.length - 1];
        const active = document.activeElement;
        if (!dialogRef.current.contains(active) || active === dialogRef.current) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        } else if (event.shiftKey && active === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, slides.length]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(50,42,30,0.45)] p-4"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        className="relative w-full max-w-lg overflow-hidden rounded-2xl border border-border bg-card shadow-lg outline-none"
      >
        <button
          onClick={onClose}
          aria-label={t(locale, 'onboarding.close')}
          className="absolute right-3 top-3 z-10 rounded-full p-1.5 text-muted transition hover:bg-paper-input hover:text-ink"
        >
          <X className="h-4 w-4" />
        </button>

        <div className="p-6">
          {slide.image ? (
            <img
              src={slide.image}
              alt=""
              className="mb-5 w-full rounded-xl border border-border-soft"
            />
          ) : (
            <div className="relative mb-5 flex items-center justify-center rounded-xl border border-border-soft bg-banner py-10">
              <Sprig className="pointer-events-none absolute -right-1 -top-1 h-12 w-12 opacity-40" />
              <img src={iconUrl} alt="" className="h-16 w-16 rounded-2xl" />
            </div>
          )}
          <h2 id={titleId} className="text-lg font-bold text-ink tracking-[2px]">
            {t(locale, slide.titleKey)}
          </h2>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {t(locale, slide.bodyKey)}
          </p>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-soft px-6 py-4">
          <div className="flex gap-1.5">
            {slides.map((s, i) => (
              <button
                key={s.titleKey}
                aria-label={formatMessage(locale, 'onboarding.goToSlide', { n: i + 1 })}
                aria-current={i === index}
                onClick={() => setIndex(i)}
                className={`h-2 rounded-full transition-all ${
                  i === index ? 'w-5 bg-accent' : 'w-2 bg-border'
                }`}
              />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {index === 0 ? (
              <button
                onClick={onClose}
                className="rounded-full px-3 py-1.5 text-sm text-muted transition hover:text-ink-secondary"
              >
                {t(locale, 'onboarding.skip')}
              </button>
            ) : (
              <button
                onClick={() => setIndex((i) => Math.max(i - 1, 0))}
                className="rounded-full border border-border px-3 py-1.5 text-sm text-ink-secondary transition hover:border-border-hover hover:bg-paper-input"
              >
                {t(locale, 'onboarding.back')}
              </button>
            )}
            <button
              onClick={next}
              className="rounded-full bg-accent px-4 py-1.5 text-sm font-medium text-on-accent shadow-sm transition hover:brightness-95"
            >
              {isLast ? t(locale, 'onboarding.getStarted') : t(locale, 'onboarding.next')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
