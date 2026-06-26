import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { t } from '../../lib/i18n';
import { SyncStatusBadgeView } from '../../entrypoints/dashboard/SyncStatusBadge';

describe('SyncStatusBadgeView', () => {
  it('renders synced status without attention styling', () => {
    const html = renderToStaticMarkup(
      <SyncStatusBadgeView status="synced" locale="en" />,
    );

    expect(html).toContain(t('en', 'sync.status.synced'));
    // Must NOT carry attention/warning styling when routine success
    expect(html).not.toContain('text-cinnabar');
    expect(html).not.toContain('attention');
  });

  it('renders needs-attention status with attention styling', () => {
    const html = renderToStaticMarkup(
      <SyncStatusBadgeView status="needs-attention" locale="en" />,
    );

    expect(html).toContain(t('en', 'sync.status.needsAttention'));
    // Must carry attention styling
    expect(html).toContain('text-cinnabar');
  });

  it('renders nothing (or disabled) when vaultId is absent (disabled)', () => {
    const html = renderToStaticMarkup(
      <SyncStatusBadgeView status="disabled" locale="en" />,
    );

    // Should not be loud — either empty or minimal
    expect(html).not.toContain('text-cinnabar');
  });

  it('works with zh-CN locale for synced', () => {
    const html = renderToStaticMarkup(
      <SyncStatusBadgeView status="synced" locale="zh-CN" />,
    );

    expect(html).toContain(t('zh-CN', 'sync.status.synced'));
  });
});
