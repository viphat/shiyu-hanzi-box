import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiApiKeySection } from '../entrypoints/settings/SettingsApp';
import { DEFAULT_AI_SETTINGS } from '../lib/ai/settings';

describe('AiApiKeySection', () => {
  it('renders a masked API key input for the settings page', () => {
    const html = renderToStaticMarkup(
      <AiApiKeySection
        locale="en"
        apiKey="sk-test"
        saving={false}
        onApiKeyChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('AI API key');
    expect(html).toContain('type="password"');
    expect(html).toContain('value="sk-test"');
  });

  it('uses the configured default API key when no key is saved', () => {
    const html = renderToStaticMarkup(
      <AiApiKeySection
        locale="zh-CN"
        apiKey={DEFAULT_AI_SETTINGS.apiKey}
        saving={false}
        onApiKeyChange={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    expect(html).toContain('AI API Key');
    expect(html).toContain('placeholder="sk-..."');
  });
});
