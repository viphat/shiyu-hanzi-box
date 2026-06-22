import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('AI settings UI ownership', () => {
  it('renders the full AI settings panel from the Settings page', () => {
    const source = readFileSync('entrypoints/settings/SettingsApp.tsx', 'utf8');

    expect(source).toContain("import { AiSettingsPanel } from './AiSettingsPanel'");
    expect(source).toContain('<AiSettingsPanel');
    expect(source).toContain('testAiConnection');
  });

  it('places Kaikki before the AI settings panel on the Settings page', () => {
    const source = readFileSync('entrypoints/settings/SettingsApp.tsx', 'utf8');

    expect(source.indexOf("t(locale, 'settings.defaultDictionary')")).toBeLessThan(
      source.indexOf("t(locale, 'dictionary.kaikki')"),
    );
    expect(source.indexOf("t(locale, 'dictionary.kaikki')")).toBeLessThan(
      source.indexOf('<AiSettingsPanel'),
    );
  });

  it('does not expose a separate AI settings button on the dashboard home page', () => {
    const source = readFileSync('entrypoints/dashboard/App.tsx', 'utf8');

    expect(source).not.toContain('AiSettingsPanel');
    expect(source).not.toContain('openAiSettings');
    expect(source).not.toContain('extraActions=');
    expect(source).not.toContain('<Sparkles');
  });
});
