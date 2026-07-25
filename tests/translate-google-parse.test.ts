import { describe, expect, it } from 'vitest';
import { parseGtxResponse } from '../lib/translate/google-parse';

describe('parseGtxResponse', () => {
  it('reads a single-segment translation', () => {
    const body = [[['Learning is a joy', '学而时习之', null, null, 3]], null, 'zh-CN'];
    expect(parseGtxResponse(body)).toEqual({ ok: true, text: 'Learning is a joy' });
  });

  it('joins every sentence segment in order', () => {
    const body = [
      [
        ['Heaven and earth are not benevolent, ', '天地不仁，', null, null, 3],
        ['treating all things as straw dogs', '以万物为刍狗', null, null, 3],
      ],
      null,
      'zh-CN',
    ];
    expect(parseGtxResponse(body)).toEqual({
      ok: true,
      text: 'Heaven and earth are not benevolent, treating all things as straw dogs',
    });
  });

  it('skips a non-string segment head rather than failing the whole parse', () => {
    const body = [[['Kept text', '保留', null, null, 3], [null, '丢弃', null, null, 3]]];
    expect(parseGtxResponse(body)).toEqual({ ok: true, text: 'Kept text' });
  });

  it('rejects a non-array body as unexpected', () => {
    expect(parseGtxResponse({ translation: 'nope' })).toEqual({ ok: false, code: 'unexpected' });
  });

  it('rejects a body whose first element is not an array', () => {
    expect(parseGtxResponse(['not-segments', null, 'zh-CN'])).toEqual({
      ok: false,
      code: 'unexpected',
    });
  });

  it('rejects null', () => {
    expect(parseGtxResponse(null)).toEqual({ ok: false, code: 'unexpected' });
  });

  it('reports empty when every segment head is unusable', () => {
    const body = [[[null, '一', null, null, 3], ['   ', '二', null, null, 3]]];
    expect(parseGtxResponse(body)).toEqual({ ok: false, code: 'empty' });
  });

  it('reports empty for a zero-segment body', () => {
    expect(parseGtxResponse([[], null, 'zh-CN'])).toEqual({ ok: false, code: 'empty' });
  });
});
