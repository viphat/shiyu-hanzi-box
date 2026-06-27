import {
  handleCapture,
  handleContextMenuCapture,
  MENU_OPEN_DASHBOARD,
  MENU_SAVE_WORD,
  MENU_SAVE_QUOTE,
} from './capture-handler';
import { registerSyncMutationHandler, SYNC_DEBOUNCE_ALARM } from './sync-mutation-handler';
import { reconcileOnStartup } from '../../lib/sync/mutations';
import { registerSyncAlarms, SYNC_ALARM } from '../../lib/sync/connect';
import { SYNC_NOW_MESSAGE } from '../settings/FolderSync';
import { getSyncConfig, mutateSyncConfig, recallKey, loadDirectoryHandle } from '../../lib/sync/local';
import { openSyncFs } from '../../lib/sync/files';
import { runSyncPass, SyncCoordinator } from '../../lib/sync/coordinator';

// Shared coordinator — single instance across alarm + message triggers.
const coordinator = new SyncCoordinator(runAlarmSyncPass);

/**
 * Builds SyncDeps from persisted state and runs one sync pass.
 * Gates: vaultId must be set, key must be recalled, handle must be loaded,
 * and handle permission must be 'granted' (no user gesture available here).
 */
async function runAlarmSyncPass() {
  const config = await getSyncConfig();

  // Gate 1: vault must be configured
  if (!config.vaultId) return { status: 'disabled' as const, warnings: [] };

  // Gate 2: encryption key must be in IndexedDB
  const key = await recallKey();
  if (!key) {
    await mutateSyncConfig((c) => ({ ...c, status: 'needs-attention', lastError: { code: 'locked' } }));
    return { status: 'needs-attention' as const, warnings: [] };
  }

  // Gate 3: directory handle must be persisted
  const handle = await loadDirectoryHandle();
  if (!handle) {
    await mutateSyncConfig((c) => ({ ...c, status: 'needs-attention', lastError: { code: 'needs-reauthorization' } }));
    return { status: 'needs-attention' as const, warnings: [] };
  }

  // Gate 4: permission must already be granted — cannot request from alarm context
  // Cast: FileSystemDirectoryHandle.queryPermission is available at runtime but not always typed
  const perm = await (handle as FileSystemDirectoryHandle & {
    queryPermission(desc: { mode: string }): Promise<string>;
  }).queryPermission({ mode: 'readwrite' });
  if (perm !== 'granted') {
    await mutateSyncConfig((c) => ({ ...c, status: 'needs-attention', lastError: { code: 'needs-reauthorization' } }));
    return { status: 'needs-attention' as const, warnings: [] };
  }

  const fs = await openSyncFs(handle);
  const { ensureReplicaId } = await import('../../lib/sync/local');
  const replicaId = await ensureReplicaId();

  return runSyncPass({ fs, key, vaultId: config.vaultId, replicaId, now: () => Date.now() });
}

/**
 * Wraps coordinator.trigger() in a defensive try/catch.
 * Unexpected errors set needs-attention rather than crashing the service worker.
 */
async function triggerSync(reason: string) {
  try {
    coordinator.trigger(reason);
    await coordinator.idle();
  } catch {
    // Unexpected error — use a generic but valid SyncErrorCode; never throw out of listener.
    await mutateSyncConfig((c) => ({
      ...c,
      status: 'needs-attention',
      lastError: { code: 'write-failure' },
    })).catch(() => {/* best effort */});
  }
}

export default defineBackground(() => {
  registerSyncMutationHandler();
  void reconcileOnStartup();
  registerSyncAlarms();

  // Alarm listener: periodic sync (every 5 min via SYNC_ALARM) + debounced sync
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM || alarm.name === SYNC_DEBOUNCE_ALARM) {
      void triggerSync('alarm');
    }
  });

  // Message listener: on-demand sync from Settings UI "Sync now" button
  browser.runtime.onMessage.addListener((message: unknown) => {
    if (
      message != null &&
      typeof message === 'object' &&
      'type' in message &&
      (message as { type: unknown }).type === SYNC_NOW_MESSAGE
    ) {
      void triggerSync('sync-now-message');
    }
  });
  // Context-menu items persist across service-worker restarts, and onInstalled
  // fires again on reload/update. Clear existing items first so re-registration
  // never fails with "Cannot create item with duplicate id".
  async function registerContextMenus() {
    await browser.contextMenus.removeAll();
    browser.contextMenus.create({
      id: MENU_SAVE_WORD,
      title: 'Save as word (拾语汉字box)',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: MENU_SAVE_QUOTE,
      title: 'Save as quote (拾语汉字box)',
      contexts: ['selection'],
    });
    browser.contextMenus.create({
      id: MENU_OPEN_DASHBOARD,
      title: 'Open dashboard (拾语汉字box)',
      contexts: ['action'],
    });
  }

  browser.runtime.onInstalled.addListener(() => registerContextMenus());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === MENU_SAVE_WORD) {
      void handleContextMenuCapture('word', info, tab);
    } else if (info.menuItemId === MENU_SAVE_QUOTE) {
      void handleContextMenuCapture('quote', info, tab);
    } else if (info.menuItemId === MENU_OPEN_DASHBOARD) {
      void browser.tabs.create({
        url: browser.runtime.getURL('/dashboard.html'),
      });
    }
  });

  browser.commands.onCommand.addListener((command) => {
    if (command === 'save-word') void handleCapture('word');
    else if (command === 'save-quote') void handleCapture('quote');
  });
});
