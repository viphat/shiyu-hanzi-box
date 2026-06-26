// entrypoints/background/sync-mutation-handler.ts
import { applyDeletion, applyLocalMutation } from '../../lib/sync/mutations';
import { setInbox } from '../../lib/storage';
import { replaceSettings } from '../../lib/settings';
import { aiSettingsStorage } from '../../lib/ai/settings';
import type { AiSettings, AppSettings, Inbox } from '../../lib/types';

export const SYNC_MUTATION_MESSAGE = 'shiyu:sync-mutation';

export interface SyncMutationRequestMessage {
  type: typeof SYNC_MUTATION_MESSAGE;
  kind: 'inbox' | 'settings' | 'ai' | 'delete';
  payload: unknown;
}

async function writeKind(kind: SyncMutationRequestMessage['kind'], payload: unknown) {
  if (kind === 'delete') {
    await applyDeletion(payload as string[]);
    return;
  }
  await applyLocalMutation(kind, async () => {
    if (kind === 'inbox') await setInbox(payload as Inbox);
    else if (kind === 'settings') await replaceSettings(payload as AppSettings);
    else await aiSettingsStorage.setValue(payload as AiSettings);
  });
}

export function registerSyncMutationHandler(): void {
  browser.runtime.onMessage.addListener((message: unknown) => {
    const msg = message as SyncMutationRequestMessage;
    if (!msg || msg.type !== SYNC_MUTATION_MESSAGE) return undefined;
    return writeKind(msg.kind, msg.payload).then(() => ({ ok: true }));
  });
}

function inBackground(): boolean {
  // Background service worker has no window/document.
  return typeof window === 'undefined';
}

export async function requestSyncMutation(
  kind: SyncMutationRequestMessage['kind'],
  payload: unknown,
): Promise<void> {
  if (inBackground()) {
    await writeKind(kind, payload);
    return;
  }
  await browser.runtime.sendMessage({ type: SYNC_MUTATION_MESSAGE, kind, payload });
}
