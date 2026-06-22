import { describe, expect, it } from 'vitest';
import { parseAiResponse, type AiParseError } from '../lib/ai/parse';

const validBody = {
  summary: 'hello; to do something',
  register: 'neutral',
  definitions: ['打招呼；问候 - hello', '做某事 - to do something'],
  sampleSentences: ['你好，很高兴认识你。', '你好世界。'],
  translations: ['Hello, nice to meet you.', 'Hello world.'],
  collocations: ['你好吗', '你好啊'],
  notes: 'Common greeting. Also used as "how are you?" with 吗.',
};

describe('parseAiResponse', () => {
  it('parses a well-formed response', () => {
    const result = parseAiResponse(
      JSON.stringify(validBody),
      'deepseek',
      'deepseek-chat',
      'https://api.deepseek.com/v1',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summary).toBe('hello; to do something');
    expect(result.value.register).toBe('neutral');
    expect(result.value.definitions).toHaveLength(2);
    expect(result.value.sampleSentences).toHaveLength(2);
    expect(result.value.translations).toHaveLength(2);
    expect(result.value.provider).toBe('deepseek');
    expect(result.value.generatedAt).toBeGreaterThan(0);
  });

  it('returns a parse error for malformed JSON', () => {
    const result = parseAiResponse('{ not json }', 'deepseek', 'deepseek-chat', '');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect((result as AiParseError).reason).toContain('JSON');
  });

  it('returns a parse error for non-object JSON', () => {
    const result = parseAiResponse('"just a string"', 'deepseek', 'deepseek-chat', '');

    expect(result.ok).toBe(false);
  });

  it('returns a parse error when required fields are missing', () => {
    const result = parseAiResponse(
      JSON.stringify({ summary: 'test' }),
      'openai',
      'gpt-4o-mini',
      'https://api.openai.com/v1',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('schema');
  });

  it('tolerates extra unknown fields', () => {
    const result = parseAiResponse(
      JSON.stringify({ ...validBody, extraField: 'ignored' }),
      'deepseek',
      'deepseek-chat',
      '',
    );

    expect(result.ok).toBe(true);
  });

  it('returns a parse error for non-array fields', () => {
    const result = parseAiResponse(
      JSON.stringify({ ...validBody, definitions: 'not an array' }),
      'deepseek',
      'deepseek-chat',
      '',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('schema');
  });

  it('returns a parse error when sample sentences and translations are not parallel', () => {
    const result = parseAiResponse(
      JSON.stringify({ ...validBody, translations: [] }),
      'deepseek',
      'deepseek-chat',
      '',
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain('parallel');
  });
});
