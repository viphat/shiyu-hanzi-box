import type { ExternalDictionaryLink } from './types';

/**
 * Build click-only outbound dictionary links. No remote content is fetched,
 * previewed, iframed, or cached — these are plain anchor hrefs the user
 * chooses to open.
 */
export function buildExternalLinks(word: string): ExternalDictionaryLink[] {
  const q = encodeURIComponent(word);
  return [
    {
      label: 'MDBG',
      language: 'Chinese-English',
      url: `https://www.mdbg.net/chinese/dictionary?wd=${q}`,
    },
    {
      label: '百度汉语',
      language: 'Chinese-Chinese',
      url: `https://hanyu.baidu.com/s?wd=${q}`,
    },
  ];
}
