import { Languages, Loader2 } from 'lucide-react';
import { t, type MessageKey } from '@/lib/i18n';
import type { TranslateFailure } from '@/lib/translate/types';
import type { UiLocale } from '@/lib/types';

export type TranslateSlotState = 'idle' | 'loading' | 'error' | 'disabled';

export interface TranslateSlot {
  state: TranslateSlotState;
  failure?: TranslateFailure;
  detail?: string;
}

const FAILURE_KEYS: Record<TranslateFailure, MessageKey> = {
  'rate-limited': 'translate.errRateLimited',
  unreachable: 'translate.errUnreachable',
  unexpected: 'translate.errUnexpected',
  'permission-denied': 'translate.errPermissionDenied',
  empty: 'translate.errEmpty',
  'not-configured': 'translate.errNotConfigured',
};

export function failureMessageKey(failure: TranslateFailure): MessageKey {
  return FAILURE_KEYS[failure];
}

function Chip({
  slot,
  hasTranslation,
  shown,
  label,
  generateTitle,
  showTitle,
  hideTitle,
  onGenerate,
  onToggle,
  locale,
}: {
  slot: TranslateSlot;
  hasTranslation: boolean;
  shown: boolean;
  label: string;
  generateTitle: string;
  showTitle: string;
  hideTitle: string;
  onGenerate: () => void;
  onToggle: () => void;
  locale: UiLocale;
}) {
  // A stored translation turns the chip into a show/hide toggle, exactly like
  // TraditionalButton's two modes.
  if (hasTranslation && slot.state !== 'loading') {
    return (
      <button
        type="button"
        title={shown ? hideTitle : showTitle}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs transition ${
          shown
            ? 'border-accent-border bg-accent-light text-accent-deep'
            : 'border-border bg-transparent text-muted hover:border-border-hover hover:text-ink-secondary'
        }`}
      >
        {label}
      </button>
    );
  }

  if (slot.state === 'loading') {
    return (
      <button
        type="button"
        disabled
        className="inline-flex cursor-not-allowed items-center gap-1 rounded-sm border border-border bg-paper-input px-1.5 py-0.5 text-xs text-muted opacity-60"
      >
        <Loader2 className="h-3 w-3 animate-spin" />
        {t(locale, 'translate.loading')}
      </button>
    );
  }

  const disabled = slot.state === 'disabled';
  const isError = slot.state === 'error';
  // When disabled, explain why in the title (hover) rather than as an inline
  // line — every quote card would otherwise ship a persistent error-colored
  // line for the common "AI not configured" state.
  const title = disabled && slot.failure ? t(locale, failureMessageKey(slot.failure)) : generateTitle;

  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        if (!disabled) onGenerate();
      }}
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-xs transition ${
        isError
          ? 'border-accent-border bg-accent-light text-accent-deep hover:bg-accent hover:text-white'
          : 'border-border bg-transparent text-muted hover:border-border-hover hover:text-ink-secondary'
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      <Languages className="h-3 w-3" />
      {isError ? t(locale, 'translate.retry') : label}
    </button>
  );
}

function SlotMessage({
  slot,
  hasTranslation,
  locale,
}: {
  slot: TranslateSlot;
  hasTranslation: boolean;
  locale: UiLocale;
}) {
  // A filled slot's chip is toggle-only, so a retry/configure line beneath it
  // would be a dead end with no reachable action — never render one here.
  if (hasTranslation) return null;
  // The 'disabled' case surfaces its reason via the chip's title instead (see
  // Chip above); an inline line here is reserved for 'error', which follows
  // an actual click and must stay visible.
  if (slot.state !== 'error') return null;
  if (!slot.failure) return null;
  const text = t(locale, failureMessageKey(slot.failure));
  return (
    <p className="text-[11px] text-accent-deep">
      {slot.detail ? `${text} ${slot.detail}` : text}
    </p>
  );
}

export function TranslateButtons({
  google,
  ai,
  hasGoogle,
  hasAi,
  shownGoogle,
  shownAi,
  onTranslateGoogle,
  onTranslateAi,
  onToggleGoogle,
  onToggleAi,
  locale,
}: {
  google: TranslateSlot;
  ai: TranslateSlot;
  hasGoogle: boolean;
  hasAi: boolean;
  shownGoogle: boolean;
  shownAi: boolean;
  onTranslateGoogle: () => void;
  onTranslateAi: () => void;
  onToggleGoogle: () => void;
  onToggleAi: () => void;
  locale: UiLocale;
}) {
  return (
    <>
      <Chip
        slot={google}
        hasTranslation={hasGoogle}
        shown={shownGoogle}
        label={t(locale, 'translate.googleShort')}
        generateTitle={t(locale, 'translate.googleTitle')}
        showTitle={t(locale, 'translate.showGoogle')}
        hideTitle={t(locale, 'translate.hideGoogle')}
        onGenerate={onTranslateGoogle}
        onToggle={onToggleGoogle}
        locale={locale}
      />
      <Chip
        slot={ai}
        hasTranslation={hasAi}
        shown={shownAi}
        label={t(locale, 'translate.aiShort')}
        generateTitle={t(locale, 'translate.aiTitle')}
        showTitle={t(locale, 'translate.showAi')}
        hideTitle={t(locale, 'translate.hideAi')}
        onGenerate={onTranslateAi}
        onToggle={onToggleAi}
        locale={locale}
      />
      {/*
        A div, not a span: SlotMessage renders <p>, which is invalid inside
        phrasing content. `basis-full` drops it onto its own line of the
        footer's flex-wrap row so both slots' errors can show at once.
      */}
      <div className="basis-full space-y-0.5">
        <SlotMessage slot={google} hasTranslation={hasGoogle} locale={locale} />
        <SlotMessage slot={ai} hasTranslation={hasAi} locale={locale} />
      </div>
    </>
  );
}
