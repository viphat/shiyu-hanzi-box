import { describe, expect, it } from 'vitest';
import { sanitizeQuoteTranslations } from '../lib/translate/validate';

describe('sanitizeQuoteTranslations', () => {
  it('keeps a valid google slot', () => {
    const result = sanitizeQuoteTranslations({ google: { text: 'Learning is a joy', generatedAt: 10 } });
    expect(result).toEqual({ google: { text: 'Learning is a joy', generatedAt: 10 } });
  });

  it('keeps a valid ai slot', () => {
    const ai = {
      text: 'To learn and practise often',
      generatedAt: 20,
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      baseUrl: 'https://api.deepseek.com',
    };
    const result = sanitizeQuoteTranslations({ ai });
    expect(result).toEqual({ ai });
  });

  it('drops a google slot whose text is not a string', () => {
    const result = sanitizeQuoteTranslations({ google: { text: 42, generatedAt: 10 } });
    expect(result).toBeUndefined();
  });

  it('drops a slot whose text is empty or whitespace-only', () => {
    expect(sanitizeQuoteTranslations({ google: { text: '', generatedAt: 10 } })).toBeUndefined();
    expect(sanitizeQuoteTranslations({ google: { text: '   ', generatedAt: 10 } })).toBeUndefined();
  });

  it('drops a slot whose generatedAt is non-finite or not a number', () => {
    expect(
      sanitizeQuoteTranslations({ google: { text: 'ok', generatedAt: Number.POSITIVE_INFINITY } }),
    ).toBeUndefined();
    expect(sanitizeQuoteTranslations({ google: { text: 'ok', generatedAt: '10' } })).toBeUndefined();
  });

  it('drops an ai slot missing provider, model, or baseUrl', () => {
    const base = { text: 'ok', generatedAt: 10 };
    expect(
      sanitizeQuoteTranslations({ ai: { ...base, model: 'm', baseUrl: 'https://x' } }),
    ).toBeUndefined();
    expect(
      sanitizeQuoteTranslations({ ai: { ...base, provider: 'deepseek', baseUrl: 'https://x' } }),
    ).toBeUndefined();
    expect(
      sanitizeQuoteTranslations({ ai: { ...base, provider: 'deepseek', model: 'm' } }),
    ).toBeUndefined();
  });

  it('returns undefined when both slots are invalid', () => {
    const result = sanitizeQuoteTranslations({
      google: { text: 42, generatedAt: 10 },
      ai: { text: 'ok', generatedAt: 10 },
    });
    expect(result).toBeUndefined();
  });

  it('keeps only the valid google slot alongside an invalid ai slot', () => {
    const result = sanitizeQuoteTranslations({
      google: { text: 'Learning is a joy', generatedAt: 10 },
      ai: { text: 'ok', generatedAt: 10 }, // missing provider/model/baseUrl
    });
    expect(result).toEqual({ google: { text: 'Learning is a joy', generatedAt: 10 } });
  });

  it('returns undefined for non-object, null, or array input', () => {
    expect(sanitizeQuoteTranslations(null)).toBeUndefined();
    expect(sanitizeQuoteTranslations(undefined)).toBeUndefined();
    expect(sanitizeQuoteTranslations('nope')).toBeUndefined();
    expect(sanitizeQuoteTranslations(42)).toBeUndefined();
    expect(sanitizeQuoteTranslations([])).toBeUndefined();
    expect(sanitizeQuoteTranslations([{ google: { text: 'ok', generatedAt: 10 } }])).toBeUndefined();
  });

  it('does not copy unknown extra keys through', () => {
    const result = sanitizeQuoteTranslations({
      google: { text: 'Learning is a joy', generatedAt: 10, extra: 'evil' },
      extraTopLevel: 'evil',
    });
    expect(result).toEqual({ google: { text: 'Learning is a joy', generatedAt: 10 } });
    expect(result).not.toHaveProperty('extraTopLevel');
    expect(result?.google).not.toHaveProperty('extra');
  });
});
