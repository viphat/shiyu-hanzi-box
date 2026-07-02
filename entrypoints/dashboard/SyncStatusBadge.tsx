import { RefreshCw, AlertCircle, CheckCircle2, Clock } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { getSyncConfig, syncConfigStorage } from '@/lib/sync/local';
import { t } from '@/lib/i18n';
import type { SyncConfig } from '@/lib/sync/local';
import type { SyncStatus } from '@/lib/sync/types';
import type { UiLocale } from '@/lib/types';

// ---- Presentational component ---- safe for renderToStaticMarkup

export function SyncStatusBadgeView({
  status,
  locale,
}: {
  status: SyncStatus;
  locale: UiLocale;
}) {
  if (status === 'disabled') {
    // Silent: sync is not configured — render nothing
    return null;
  }

  const isAttention = status === 'needs-attention';
  const isSyncing = status === 'syncing';

  const statusKey = (
    {
      synced: 'sync.status.synced',
      syncing: 'sync.status.syncing',
      pending: 'sync.status.pending',
      'needs-attention': 'sync.status.needsAttention',
      disabled: 'sync.status.disabled',
    } as const
  )[status];

  const label = t(locale, statusKey as Parameters<typeof t>[1]);

  function icon() {
    if (isAttention) return <AlertCircle className="h-3 w-3" aria-hidden="true" />;
    if (isSyncing) return <RefreshCw className="h-3 w-3 animate-spin" aria-hidden="true" />;
    if (status === 'synced') return <CheckCircle2 className="h-3 w-3" aria-hidden="true" />;
    // Only 'pending' remains ('disabled' returned null above).
    return <Clock className="h-3 w-3" aria-hidden="true" />;
  }

  const baseClass =
    'inline-flex items-center gap-1 rounded-sm border px-2 py-1 text-[11px] tracking-[1px]';
  const colorClass = isAttention
    ? 'border-accent-border bg-accent-light text-accent-deep'
    : 'border-border bg-paper-input text-muted';

  return (
    <span className={`${baseClass} ${colorClass}`} role="status" aria-label={label}>
      {icon()}
      {label}
    </span>
  );
}

// ---- Container component ---- subscribes to syncConfigStorage

function openSettings() {
  void browser.tabs.create({ url: browser.runtime.getURL('/settings.html') });
}

export function SyncStatusBadge({ locale }: { locale: UiLocale }) {
  const [config, setConfig] = useState<SyncConfig | null>(null);

  useEffect(() => {
    let mounted = true;
    void getSyncConfig().then((cfg) => {
      if (mounted) setConfig(cfg);
    });
    const unwatch = syncConfigStorage.watch((cfg) => {
      if (mounted) setConfig(cfg);
    });
    return () => {
      mounted = false;
      unwatch();
    };
  }, []);

  if (!config || !config.vaultId) {
    // Not configured — render nothing
    return null;
  }

  return (
    <button
      type="button"
      onClick={openSettings}
      title={t(locale, 'sync.section.title')}
      className="cursor-pointer appearance-none border-0 bg-transparent p-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <SyncStatusBadgeView status={config.status} locale={locale} />
    </button>
  );
}
