import type { ToneChip as ToneChipData } from '@/lib/types';

const TONE_TAILWIND: Record<number, string> = {
  0: 'border-border text-muted',
  1: 'border-border text-ink',
  2: 'border-border text-ink',
  3: 'border-accent-border text-accent-deep',
  4: 'border-accent-border text-accent-deep',
};

export function ToneChips({ chips }: { chips: ToneChipData[] }) {
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {chips.map((chip, i) => (
        <span
          key={i}
          className={`inline-flex flex-col items-center rounded-sm border bg-paper-input px-2 py-1 text-xs leading-tight ${TONE_TAILWIND[chip.tone]}`}
        >
          <span className="text-base font-semibold tracking-[1px]">{chip.text || '·'}</span>
          <span>{chip.mark}</span>
          <span className="text-[10px] text-muted">{chip.numbered}</span>
        </span>
      ))}
    </div>
  );
}
