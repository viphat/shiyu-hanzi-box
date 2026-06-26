import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../../lib/i18n';
import { FolderSync } from '../../entrypoints/settings/FolderSync';

describe('FolderSync UI', () => {
  it('shows the unsupported message when File System Access is absent', () => {
    const original = (globalThis as Record<string, unknown>).showDirectoryPicker;
    delete (globalThis as Record<string, unknown>).showDirectoryPicker;

    const html = renderToStaticMarkup(<FolderSync locale="zh-CN" />);

    expect(html).toContain(t('zh-CN', 'sync.unsupported'));

    if (original !== undefined) {
      (globalThis as Record<string, unknown>).showDirectoryPicker = original;
    }
  });

  it('renders create and join actions when File System Access is supported', () => {
    (globalThis as Record<string, unknown>).showDirectoryPicker = () => {};

    const html = renderToStaticMarkup(<FolderSync locale="zh-CN" />);

    expect(html).toContain(t('zh-CN', 'sync.action.createVault'));
    expect(html).toContain(t('zh-CN', 'sync.action.joinVault'));

    delete (globalThis as Record<string, unknown>).showDirectoryPicker;
  });
});
