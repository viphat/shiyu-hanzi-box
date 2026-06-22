import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { WordCard } from '../entrypoints/dashboard/components/WordCard';
import { messages, t } from '../lib/i18n';
import type { WordEntry } from '../lib/types';

const word: WordEntry = {
  id: 'w1',
  kind: 'word',
  text: '你好',
  normalized: '你好',
  note: '',
  status: 'inbox',
  createdAt: 1,
  updatedAt: 1,
  occurrences: [],
};

describe('WordCard', () => {
  it('keeps the AI expand title in i18n messages', () => {
    expect(messages.en).toHaveProperty('word.openAiInsight', 'Open AI insight');
    expect(messages['zh-CN']).toHaveProperty('word.openAiInsight', '打开 AI 释义');
  });

  it('shows a visible AI entry point before the card is expanded', () => {
    const html = renderToStaticMarkup(
      <WordCard
        word={word}
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        locale="en"
      />,
    );

    expect(html).toContain(t('en', 'word.openAiInsight'));
    expect(html).toContain('AI');
    expect(html).toContain('lucide-sparkles');
  });
});
