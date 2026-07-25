import { describe, expect, it } from 'vitest';
import { parseTranslation } from '../lib/ai/translate-parse';

describe('parseTranslation', () => {
  it('accepts a valid translation object', () => {
    expect(parseTranslation('{"translation":"Learning is a joy"}')).toEqual({
      ok: true,
      text: 'Learning is a joy',
    });
  });

  it('trims surrounding whitespace from the translation', () => {
    expect(parseTranslation('{"translation":"  Learning is a joy \\n"}')).toEqual({
      ok: true,
      text: 'Learning is a joy',
    });
  });

  it('rejects invalid JSON', () => {
    expect(parseTranslation('not json')).toEqual({ ok: false, code: 'unexpected' });
  });

  it('rejects a JSON array', () => {
    expect(parseTranslation('["Learning is a joy"]')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects JSON null', () => {
    expect(parseTranslation('null')).toEqual({ ok: false, code: 'unexpected' });
  });

  it('rejects a missing translation key', () => {
    expect(parseTranslation('{"text":"Learning is a joy"}')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects a non-string translation', () => {
    expect(parseTranslation('{"translation":42}')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects a whitespace-only translation', () => {
    expect(parseTranslation('{"translation":"   "}')).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });
});
