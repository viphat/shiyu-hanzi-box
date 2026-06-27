import type { QuoteEntry, UiLocale } from '@/lib/types';
export function TagCloud(_props: {
  quotes: QuoteEntry[];
  selectedTags: Set<string>;
  onSelect: (tag: string) => void;
  onRename: (from: string, to: string) => void;
  onDelete: (tag: string) => void;
  locale: UiLocale;
}) {
  return null;
}
