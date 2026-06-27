import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../../lib/i18n';
import { FolderSync, PassphraseDialog } from '../../entrypoints/settings/FolderSync';

const noop = () => {};

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

describe('PassphraseDialog — confirm-passphrase field gating', () => {
  it('create flow (requireConfirm=true): renders the confirm-passphrase label', () => {
    const html = renderToStaticMarkup(
      <PassphraseDialog
        locale="en"
        title="Create vault"
        confirmLabel="Create"
        requireConfirm={true}
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(html).toContain(t('en', 'sync.dialog.passphraseConfirm'));
  });

  it('join flow (requireConfirm=false): does NOT render the confirm-passphrase label', () => {
    const html = renderToStaticMarkup(
      <PassphraseDialog
        locale="en"
        title="Join vault"
        confirmLabel="Join"
        requireConfirm={false}
        onConfirm={noop}
        onCancel={noop}
      />,
    );

    expect(html).not.toContain(t('en', 'sync.dialog.passphraseConfirm'));
  });
});
