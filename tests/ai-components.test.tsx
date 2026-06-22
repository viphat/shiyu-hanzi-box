import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiInsightSection } from '../entrypoints/dashboard/components/AiInsightSection';
import { AskAiButton } from '../entrypoints/dashboard/components/AskAiButton';
import type { AiInsight } from '../lib/types';

const insight: AiInsight = {
  provider: 'deepseek',
  model: 'deepseek-chat',
  baseUrl: 'https://api.deepseek.com/v1',
  generatedAt: Date.UTC(2026, 5, 20),
  summary: 'hello greeting',
  register: 'neutral',
  definitions: ['打招呼 - hello'],
  sampleSentences: ['你好世界。'],
  translations: ['Hello world.'],
  collocations: ['你好吗'],
  notes: 'Common greeting.',
};

describe('AskAiButton', () => {
  it('renders disabled guidance when AI is not configured', () => {
    const html = renderToStaticMarkup(
      <AskAiButton state="disabled" error="Configure AI to use this." onAsk={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(html).toContain('Ask AI');
    expect(html).toContain('Configure AI to use this.');
    expect(html).toContain('disabled');
  });

  it('renders retry copy for an error state', () => {
    const html = renderToStaticMarkup(
      <AskAiButton state="error" error="Provider unreachable" onAsk={vi.fn()} onRetry={vi.fn()} />,
    );

    expect(html).toContain('重试');
    expect(html).toContain('Provider unreachable');
  });
});

describe('AiInsightSection', () => {
  it('renders persisted insight content', () => {
    const html = renderToStaticMarkup(
      <AiInsightSection insight={insight} onRegenerate={vi.fn()} />,
    );

    expect(html).toContain('AI 释义');
    expect(html).toContain('hello greeting');
    expect(html).toContain('你好世界。');
    expect(html).toContain('Hello world.');
    expect(html).toContain('deepseek-chat');
  });
});
