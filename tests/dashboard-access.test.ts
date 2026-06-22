import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('optional dashboard access source layout', () => {
  it('uses an unlisted dashboard entrypoint instead of the newtab override entrypoint', () => {
    expect(existsSync('entrypoints/dashboard/index.html')).toBe(true);
    expect(existsSync('entrypoints/dashboard/main.tsx')).toBe(true);
    expect(existsSync('entrypoints/dashboard/App.tsx')).toBe(true);
    expect(existsSync('entrypoints/newtab/index.html')).toBe(false);
  });

  it('settings navigates back to dashboard.html', () => {
    const source = read('entrypoints/settings/SettingsApp.tsx');

    expect(source).toContain("browser.runtime.getURL('/dashboard.html')");
    expect(source).not.toContain("browser.runtime.getURL('/newtab.html')");
    expect(source).toContain("from '../dashboard/hooks/useSettings'");
  });

  it('popup exposes a localized open-dashboard action', () => {
    const source = read('entrypoints/popup/Popup.tsx');

    expect(source).toContain('function openDashboard');
    expect(source).toContain("browser.runtime.getURL('/dashboard.html')");
    expect(source).toContain("t(locale, 'popup.openDashboard')");
  });

  it('current docs describe optional dashboard access without new-tab takeover wording', () => {
    const readme = read('README.md');
    const reviewerNotes = read('docs/chrome-web-store-reviewer-notes.md');
    const checklist = read('docs/chrome-web-store-dashboard-checklist.md');
    const agents = read('AGENTS.md');

    expect(readme).toContain('Dashboard page opened from the toolbar popup or extension action menu');
    expect(readme).toContain('entrypoints/dashboard/');
    expect(readme).not.toContain('New-tab dashboard');
    expect(reviewerNotes).toContain('Open the dashboard from the toolbar popup');
    expect(reviewerNotes).not.toContain('uses a new-tab override');
    expect(checklist).toContain('contextMenus: Adds user-triggered "save as word", "save as quote", and "open dashboard" actions.');
    expect(agents).toContain('entrypoints/dashboard/App.tsx');
    expect(agents).not.toContain('entrypoints/newtab/');
  });
});
