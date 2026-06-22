import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiSettingsPanel } from '../entrypoints/settings/AiSettingsPanel';
import { DEFAULT_SETTINGS } from '../lib/ai/settings';

describe('AiSettingsPanel', () => {
  it('renders provider, API key, base URL, and model controls', () => {
    const html = renderToStaticMarkup(
      <AiSettingsPanel
        settings={{ ...DEFAULT_SETTINGS, apiKey: 'sk-test' }}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
        testing={false}
        testResult={null}
      />,
    );

    expect(html).toContain('AI 设置');
    expect(html).toContain('lucide-sparkles');
    expect(html).toContain('Provider');
    expect(html).toContain('API Key');
    expect(html).toContain('type="password"');
    expect(html).toContain('Base URL');
    expect(html).toContain('Model');
  });

  it('shows a test connection result', () => {
    const html = renderToStaticMarkup(
      <AiSettingsPanel
        settings={DEFAULT_SETTINGS}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onTestConnection={vi.fn()}
        testing={false}
        testResult={{ ok: false, message: 'Provider permission was not granted.' }}
      />,
    );

    expect(html).toContain('Provider permission was not granted.');
  });
});
