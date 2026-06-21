import { describe, expect, it } from 'vitest';
import { buildExternalLinks } from '../lib/external-dictionaries';

describe('buildExternalLinks', () => {
  it('builds a Youdao link with the encoded word', () => {
    const links = buildExternalLinks('你好');
    const youdao = links.find((l) => l.label === 'Youdao')!;
    expect(youdao.url).toBe(
      'https://www.youdao.com/result?word=' + encodeURIComponent('你好') + '&lang=en',
    );
    expect(youdao.language).toBe('Chinese-English');
  });

  it('builds a 百度汉语 link with the encoded word', () => {
    const links = buildExternalLinks('你好');
    const baidu = links.find((l) => l.label === '百度汉语')!;
    expect(baidu.url).toBe('https://hanyu.baidu.com/s?wd=' + encodeURIComponent('你好'));
    expect(baidu.language).toBe('Chinese-Chinese');
  });

  it('preserves traditional characters in the query', () => {
    const links = buildExternalLinks('龍');
    expect(links[0].url).toContain(encodeURIComponent('龍'));
  });

  it('returns both links in a stable order (Youdao first)', () => {
    const links = buildExternalLinks('龙');
    expect(links.map((l) => l.label)).toEqual(['Youdao', '百度汉语']);
  });
});
