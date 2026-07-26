import type { ExternalDictionaryLink } from './types';

/**
 * Build click-only outbound dictionary links. No remote content is fetched,
 * previewed, iframed, or cached — these are plain anchor hrefs the user
 * chooses to open.
 */
export function buildExternalLinks(
  word: string,
  cvdictEnabled = false,
): ExternalDictionaryLink[] {
  const q = encodeURIComponent(word);
  return [
    {
      label: 'Youdao',
      language: 'Chinese-English',
      url: `https://www.youdao.com/result?word=${q}&lang=en`,
    },
    {
      label: '百度汉语',
      language: 'Chinese-Chinese',
      url: `https://hanyu.baidu.com/s?wd=${q}`,
    },
    ...(cvdictEnabled
      ? [{
          label: 'Hanzii' as const,
          labelKey: 'dictionary.hanziiLookup' as const,
          language: 'Chinese-Vietnamese' as const,
          url: `https://hanzii.net/search/word/${q}?hl=vi`,
        }]
      : []),
  ];
}
