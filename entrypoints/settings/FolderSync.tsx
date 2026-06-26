import { FolderSync as FolderSyncIcon, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { createVault, joinVault, disconnect } from '@/lib/sync/connect';
import { getSyncConfig, syncConfigStorage } from '@/lib/sync/local';
import { t } from '@/lib/i18n';
import type { SyncConfig } from '@/lib/sync/local';
import type { UiLocale } from '@/lib/types';

declare function showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;

// Message type for triggering a sync pass from settings UI.
// The background coordinator (Task 17) listens for this message.
export const SYNC_NOW_MESSAGE = 'shiyu:sync:now' as const;

// Feature-detect File System Access API
function isFsaSupported(): boolean {
  return typeof (globalThis as Record<string, unknown>).showDirectoryPicker === 'function';
}

// ---- Presentational inner component ----
// Props-in → markup-out, safe for renderToStaticMarkup.

type FolderSyncViewProps =
  | { supported: false; locale: UiLocale }
  | { supported: true; connected: false; locale: UiLocale; onCreateVault: () => void; onJoinVault: () => void }
  | {
      supported: true;
      connected: true;
      locale: UiLocale;
      config: SyncConfig;
      onSyncNow: () => void;
      onReauthorize: () => void;
      onForgetKey: () => void;
      onDisconnect: () => void;
    };

export function FolderSyncView(props: FolderSyncViewProps) {
  const { locale } = props;

  return (
    <section className="rounded-sm border border-border bg-paper-light p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <FolderSyncIcon className="h-4 w-4 text-cinnabar" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-[2px]">
          {t(locale, 'sync.section.title')}
        </h2>
      </div>

      {!props.supported && (
        <p className="text-xs text-muted">{t(locale, 'sync.unsupported')}</p>
      )}

      {props.supported && !props.connected && (
        <FolderSyncDisconnectedView locale={locale} onCreateVault={props.onCreateVault} onJoinVault={props.onJoinVault} />
      )}

      {props.supported && props.connected && (
        <FolderSyncConnectedView
          locale={locale}
          config={props.config}
          onSyncNow={props.onSyncNow}
          onReauthorize={props.onReauthorize}
          onForgetKey={props.onForgetKey}
          onDisconnect={props.onDisconnect}
        />
      )}
    </section>
  );
}

function FolderSyncDisconnectedView({
  locale,
  onCreateVault,
  onJoinVault,
}: {
  locale: UiLocale;
  onCreateVault: () => void;
  onJoinVault: () => void;
}) {
  return (
    <div>
      <ul className="mb-4 space-y-1.5 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
        <li>{t(locale, 'sync.warn.passphraseUnrecoverable')}</li>
        <li>{t(locale, 'sync.warn.includesApiKey')}</li>
        <li>{t(locale, 'sync.warn.localProfileSecurity')}</li>
        <li>{t(locale, 'sync.warn.eventualConsistency')}</li>
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onCreateVault}
          className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2 text-xs font-medium text-white shadow-sm tracking-[1px] transition hover:brightness-95"
        >
          {t(locale, 'sync.action.createVault')}
        </button>
        <button
          type="button"
          onClick={onJoinVault}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-2 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input"
        >
          {t(locale, 'sync.action.joinVault')}
        </button>
      </div>
    </div>
  );
}

function FolderSyncConnectedView({
  locale,
  config,
  onSyncNow,
  onReauthorize,
  onForgetKey,
  onDisconnect,
}: {
  locale: UiLocale;
  config: SyncConfig;
  onSyncNow: () => void;
  onReauthorize: () => void;
  onForgetKey: () => void;
  onDisconnect: () => void;
}) {
  const vaultIdAbbr = config.vaultId
    ? `${config.vaultId.slice(0, 8)}…${config.vaultId.slice(-4)}`
    : '—';

  const lastSuccessText = config.lastSuccessAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(config.lastSuccessAt),
      )
    : '—';

  const statusKey = (
    {
      disabled: 'sync.status.disabled',
      synced: 'sync.status.synced',
      syncing: 'sync.status.syncing',
      pending: 'sync.status.pending',
      'needs-attention': 'sync.status.needsAttention',
    } as const
  )[config.status];

  return (
    <div>
      <dl className="mb-3 grid gap-2 text-xs text-muted sm:grid-cols-2">
        {config.folderName && (
          <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
            <dt className="font-medium text-muted">{t(locale, 'sync.field.folder')}</dt>
            <dd className="mt-0.5 font-medium text-ink-secondary">{config.folderName}</dd>
          </div>
        )}
        <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
          <dt>{t(locale, 'sync.field.vaultId')}</dt>
          <dd className="mt-0.5 font-mono text-ink-secondary">{vaultIdAbbr}</dd>
        </div>
        <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
          <dt>{t(locale, 'sync.field.status')}</dt>
          <dd className="mt-0.5 text-ink-secondary">
            {t(locale, statusKey as Parameters<typeof t>[1])}
            {config.pending && (
              <RefreshCw className="ml-1 inline h-3 w-3 animate-spin" aria-label="pending" />
            )}
          </dd>
        </div>
        <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
          <dt>{t(locale, 'sync.field.lastSync')}</dt>
          <dd className="mt-0.5 text-ink-secondary">{lastSuccessText}</dd>
        </div>
        {config.replicaLabel && (
          <div className="rounded-sm border border-border bg-paper-input px-2 py-1.5">
            <dt>{t(locale, 'sync.field.label')}</dt>
            <dd className="mt-0.5 text-ink-secondary">{config.replicaLabel}</dd>
          </div>
        )}
      </dl>

      {config.lastError && (
        <p className="mb-3 rounded-sm border border-cinnabar-border bg-cinnabar-light px-3 py-2 text-xs text-cinnabar">
          {config.lastError.code}
          {config.lastError.replica ? ` (${config.lastError.replica})` : ''}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onSyncNow}
          className="inline-flex items-center gap-1 rounded-sm bg-cinnabar px-3 py-2 text-xs font-medium text-white shadow-sm tracking-[1px] transition hover:brightness-95"
        >
          {t(locale, 'sync.action.syncNow')}
        </button>
        <button
          type="button"
          onClick={onReauthorize}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-2 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input"
        >
          {t(locale, 'sync.action.reauthorize')}
        </button>
        <button
          type="button"
          onClick={onForgetKey}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-2 text-xs font-medium text-ink-secondary tracking-[1px] transition hover:border-border-hover hover:bg-paper-input"
        >
          {t(locale, 'sync.action.forgetKey')}
        </button>
        <button
          type="button"
          onClick={onDisconnect}
          className="inline-flex items-center gap-1 rounded-sm border border-border px-3 py-2 text-xs font-medium text-cinnabar tracking-[1px] transition hover:border-cinnabar-border hover:bg-cinnabar-light"
        >
          {t(locale, 'sync.action.disconnect')}
        </button>
      </div>
    </div>
  );
}

// ---- Dialog components ----

function PassphraseDialog({
  locale,
  title,
  warning,
  confirmLabel,
  onConfirm,
  onCancel,
}: {
  locale: UiLocale;
  title: string;
  warning?: string;
  confirmLabel: string;
  onConfirm: (passphrase: string, label: string) => void;
  onCancel: () => void;
}) {
  const [passphrase, setPassphrase] = useState('');
  const [label, setLabel] = useState('');
  const [confirmed, setConfirmed] = useState(!warning);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-sm border border-border bg-paper-light p-5 shadow-lg">
        <h3 className="mb-3 text-sm font-semibold tracking-[2px]">{title}</h3>

        {warning && (
          <div className="mb-3 rounded-sm border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
            <p className="mb-2">{warning}</p>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="accent-cinnabar"
              />
              {t(locale, 'sync.dialog.iUnderstand')}
            </label>
          </div>
        )}

        <div className="space-y-3">
          <label className="block text-[11px] font-medium text-muted">
            {t(locale, 'sync.dialog.passphrase')}
            <input
              type="password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-cinnabar-fade"
              autoFocus
            />
          </label>
          <label className="block text-[11px] font-medium text-muted">
            {t(locale, 'sync.dialog.deviceLabel')}
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t(locale, 'sync.dialog.deviceLabelPlaceholder')}
              className="mt-1 w-full rounded-sm border border-border bg-paper-input px-2 py-1.5 text-xs text-ink outline-none focus:border-cinnabar-fade"
            />
          </label>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-sm border border-border px-3 py-1.5 text-xs text-ink-secondary tracking-[1px] transition hover:bg-paper-input"
          >
            {t(locale, 'sync.dialog.cancel')}
          </button>
          <button
            type="button"
            disabled={!passphrase || !confirmed}
            onClick={() => onConfirm(passphrase, label)}
            className="rounded-sm bg-cinnabar px-3 py-1.5 text-xs font-medium text-white tracking-[1px] transition hover:brightness-95 disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Connected container ----

export function FolderSync({ locale = 'zh-CN' }: { locale?: UiLocale }) {
  const [config, setConfig] = useState<SyncConfig | null>(null);
  const [dialog, setDialog] = useState<'create' | 'join' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getSyncConfig().then((cfg) => {
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

  const supported = isFsaSupported();
  const connected = !!(config?.vaultId);

  async function handleCreateVault(passphrase: string, label: string) {
    setDialog(null);
    setError(null);
    try {
      const dir = await showDirectoryPicker();
      await createVault(dir, passphrase, label, Date.now());
      const next = await getSyncConfig();
      setConfig(next);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    }
  }

  async function handleJoinVault(passphrase: string, label: string) {
    setDialog(null);
    setError(null);
    try {
      const dir = await showDirectoryPicker();
      await joinVault(dir, passphrase, label, Date.now());
      const next = await getSyncConfig();
      setConfig(next);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    }
  }

  function handleSyncNow() {
    // Task 17 will wire the background coordinator listener.
    // Send a message to the background; the coordinator handler is added in Task 17.
    browser.runtime.sendMessage({ type: SYNC_NOW_MESSAGE }).catch(() => {
      // Background may not be listening yet (Task 17).
    });
  }

  async function handleReauthorize() {
    setError(null);
    try {
      const dir = await showDirectoryPicker();
      const { saveDirectoryHandle } = await import('@/lib/sync/local');
      await saveDirectoryHandle(dir);
      const next = await getSyncConfig();
      setConfig(next);
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setError(err.message);
      }
    }
  }

  async function handleForgetKey() {
    const { forgetKey } = await import('@/lib/sync/local');
    await forgetKey();
    const next = await getSyncConfig();
    setConfig(next);
  }

  async function handleDisconnect() {
    await disconnect();
    const next = await getSyncConfig();
    setConfig(next);
  }

  const viewProps: FolderSyncViewProps = !supported
    ? { supported: false, locale }
    : connected && config
      ? {
          supported: true,
          connected: true,
          locale,
          config,
          onSyncNow: handleSyncNow,
          onReauthorize: () => void handleReauthorize(),
          onForgetKey: () => void handleForgetKey(),
          onDisconnect: () => void handleDisconnect(),
        }
      : {
          supported: true,
          connected: false,
          locale,
          onCreateVault: () => setDialog('create'),
          onJoinVault: () => setDialog('join'),
        };

  return (
    <>
      <FolderSyncView {...viewProps} />

      {error && (
        <p className="text-xs text-cinnabar tracking-[1px]">{error}</p>
      )}

      {dialog === 'create' && (
        <PassphraseDialog
          locale={locale}
          title={t(locale, 'sync.action.createVault')}
          confirmLabel={t(locale, 'sync.action.createVault')}
          onConfirm={(p, l) => void handleCreateVault(p, l)}
          onCancel={() => setDialog(null)}
        />
      )}

      {dialog === 'join' && (
        <PassphraseDialog
          locale={locale}
          title={t(locale, 'sync.action.joinVault')}
          warning={t(locale, 'sync.warn.joinReplacesSettings')}
          confirmLabel={t(locale, 'sync.action.joinVault')}
          onConfirm={(p, l) => void handleJoinVault(p, l)}
          onCancel={() => setDialog(null)}
        />
      )}
    </>
  );
}
