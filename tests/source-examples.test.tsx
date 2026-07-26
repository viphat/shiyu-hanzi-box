import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SourceExamples } from '../entrypoints/dashboard/components/SourceExamples';

describe('SourceExamples external links', () => {
  it('renders the localized Hanzii label as a click-only outbound anchor', () => {
    const html = renderToStaticMarkup(
      <SourceExamples
        examples={[]}
        externalLinks={[{
          label: 'Hanzii',
          labelKey: 'dictionary.hanziiLookup',
          language: 'Chinese-Vietnamese',
          url: 'https://hanzii.net/search/word/%E4%BD%A0%E5%A5%BD?hl=vi',
        }]}
        locale="zh-CN"
      />,
    );

    expect(html).toContain('Hanzii · 越南语');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
  });
});
