//
// Tests for review finding #3: settings/AI are stamped by real last-edit time,
// so a fresh joiner's epoch-stamped (0) settings do NOT wipe the vault's
// configured AI key/provider/model, and per-pass re-stamping is eliminated.

import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { MemoryFs } from '../../lib/sync/files';
import { createVaultOnFs, joinVaultOnFs } from '../../lib/sync/connect';
import { syncMetadataStorage } from '../../lib/sync/mutations';
import { projectInbox } from '../../lib/sync/project';
import { mergeSyncState } from '../../lib/sync/merge';
import { materialize } from '../../lib/sync/project';
import { DEFAULT_SETTINGS } from '../../lib/settings';
import { DEFAULT_AI_SETTINGS } from '../../lib/ai/settings';
import { aiSettingsStorage } from '../../lib/ai/settings';
import type { Inbox } from '../../lib/types';

const EMPTY_INBOX: Inbox = { words: [], quotes: [] };

// ---------------------------------------------------------------------------
// Test 1: Join does NOT wipe the vault's AI key
// ---------------------------------------------------------------------------
describe('join does not wipe vault AI key', () => {
  beforeEach(() => fakeBrowser.reset());

  it('preserves the vault creator AI key when a fresh profile joins', async () => {
    const fs = new MemoryFs();

    // Step 1: Creator sets up a vault with a configured AI key.
    // We simulate that by writing a real aiSettingsUpdatedAt before creating.
    const CREATOR_EDIT_TIME = 1_700_000_000_000; // a real timestamp, not 0
    await syncMetadataStorage.setValue({
      revision: 0,
      state: null,
      lastDigest: null,
      appSettingsUpdatedAt: 0,
      aiSettingsUpdatedAt: CREATOR_EDIT_TIME,
    });
    // Store the configured AI key for the creator's current profile.
    const creatorAi = { ...DEFAULT_AI_SETTINGS, apiKey: 'vault-secret-key', enabled: true, provider: 'openai' as const };
    await aiSettingsStorage.setValue(creatorAi);

    await createVaultOnFs(fs, 'pw', 'Creator', CREATOR_EDIT_TIME);

    // Verify the vault has the AI key in its state.
    // (createVaultOnFs writes the replica, which is what joinVaultOnFs reads.)

    // Step 2: Reset to a fresh profile (no AI key configured, epoch stamp).
    await fakeBrowser.reset();
    // After reset, syncMetadata fallback = { appSettingsUpdatedAt: 0, aiSettingsUpdatedAt: 0 }
    // and aiSettingsStorage will return DEFAULT_AI_SETTINGS (empty apiKey).

    // Step 3: Fresh profile joins the vault.
    await joinVaultOnFs(fs, 'pw', 'Joiner', Date.now());

    // Step 4: Assert the merged AI settings retain the vault's apiKey.
    const mergedAi = await aiSettingsStorage.getValue();
    expect(mergedAi.apiKey).toBe('vault-secret-key');
    expect(mergedAi.enabled).toBe(true);
    expect(mergedAi.provider).toBe('openai');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Epoch (0) stamp loses to any real stamp in mergeSyncState
// ---------------------------------------------------------------------------
describe('epoch-stamped settings lose to real-stamped settings', () => {
  it('real stamp wins over epoch stamp for the same field', () => {
    const REAL_TIME = 1_700_000_000_000;

    // Vault replica: real stamp on AI settings.
    const vaultState = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, {
      ...DEFAULT_AI_SETTINGS, apiKey: 'vault-key',
    }, { replicaId: 'vault', wallTime: 1000, aiStamp: REAL_TIME });

    // Joiner: epoch stamp (0) — never edited.
    const joinerState = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, {
      ...DEFAULT_AI_SETTINGS, apiKey: '',
    }, { replicaId: 'joiner', wallTime: 2000, aiStamp: 0 });

    // mergeSyncState(remote=vault, local=joiner): vault's real stamp should win.
    const merged = mergeSyncState(vaultState, joinerState);
    const out = materialize(merged);
    expect(out.ai.apiKey).toBe('vault-key');
  });

  it('newer real stamp wins over older real stamp', () => {
    const OLDER_TIME = 1_000_000_000_000;
    const NEWER_TIME = 2_000_000_000_000;

    const olderState = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, {
      ...DEFAULT_AI_SETTINGS, apiKey: 'old-key',
    }, { replicaId: 'A', wallTime: 1000, aiStamp: OLDER_TIME });

    const newerState = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, {
      ...DEFAULT_AI_SETTINGS, apiKey: 'new-key',
    }, { replicaId: 'B', wallTime: 1000, aiStamp: NEWER_TIME });

    const merged = mergeSyncState(olderState, newerState);
    const out = materialize(merged);
    expect(out.ai.apiKey).toBe('new-key');
  });
});

// ---------------------------------------------------------------------------
// Test 3: No per-pass re-stamp (same stored stamp -> same projected stamp)
// ---------------------------------------------------------------------------
describe('no per-pass last-synced flip', () => {
  it('projecting settings twice with the same stored stamp produces identical stamps', () => {
    const SETTINGS_EDIT_TIME = 1_700_000_000_000;
    const ctx1 = { replicaId: 'R', wallTime: 1000, settingsStamp: SETTINGS_EDIT_TIME, aiStamp: 0 };
    const ctx2 = { replicaId: 'R', wallTime: 9999, settingsStamp: SETTINGS_EDIT_TIME, aiStamp: 0 }; // wallTime differs!

    const state1 = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx1);
    const state2 = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx2);

    // The appSettings stamps should be identical (sourced from settingsStamp, not wallTime).
    for (const field of Object.keys(state1.appSettings)) {
      expect(state1.appSettings[field].stamp.wallTime).toBe(SETTINGS_EDIT_TIME);
      expect(state2.appSettings[field].stamp.wallTime).toBe(SETTINGS_EDIT_TIME);
    }
    // kaikkiSource also uses settingsStamp.
    expect(state1.kaikkiSource.sourceUrl.stamp.wallTime).toBe(SETTINGS_EDIT_TIME);
    expect(state2.kaikkiSource.sourceUrl.stamp.wallTime).toBe(SETTINGS_EDIT_TIME);
  });

  it('epoch-stamped (0) projection does not pick up wallTime', () => {
    const ctx = { replicaId: 'R', wallTime: 99999, settingsStamp: 0, aiStamp: 0 };
    const state = projectInbox(EMPTY_INBOX, DEFAULT_SETTINGS, DEFAULT_AI_SETTINGS, ctx);
    // With epoch stamp, every settings/AI register should have wallTime = 0, NOT 99999.
    for (const field of Object.keys(state.appSettings)) {
      expect(state.appSettings[field].stamp.wallTime).toBe(0);
    }
    for (const field of Object.keys(state.aiSettings)) {
      expect(state.aiSettings[field].stamp.wallTime).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 4: applyLocalMutation('settings'/'ai') bumps the tracked timestamps
// ---------------------------------------------------------------------------
describe('applyLocalMutation tracks settings/ai edit timestamps', () => {
  beforeEach(() => fakeBrowser.reset());

  it('bumps appSettingsUpdatedAt on kind=settings', async () => {
    const { applyLocalMutation } = await import('../../lib/sync/mutations');
    const before = Date.now();
    await applyLocalMutation('settings', async () => {});
    const after = Date.now();
    const meta = await syncMetadataStorage.getValue();
    expect(meta.appSettingsUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(meta.appSettingsUpdatedAt).toBeLessThanOrEqual(after);
    expect(meta.aiSettingsUpdatedAt).toBe(0); // unchanged
  });

  it('bumps aiSettingsUpdatedAt on kind=ai', async () => {
    const { applyLocalMutation } = await import('../../lib/sync/mutations');
    const before = Date.now();
    await applyLocalMutation('ai', async () => {});
    const after = Date.now();
    const meta = await syncMetadataStorage.getValue();
    expect(meta.aiSettingsUpdatedAt).toBeGreaterThanOrEqual(before);
    expect(meta.aiSettingsUpdatedAt).toBeLessThanOrEqual(after);
    expect(meta.appSettingsUpdatedAt).toBe(0); // unchanged
  });

  it('does NOT bump settings timestamps on kind=inbox', async () => {
    const { applyLocalMutation } = await import('../../lib/sync/mutations');
    await applyLocalMutation('inbox', async () => {});
    const meta = await syncMetadataStorage.getValue();
    expect(meta.appSettingsUpdatedAt).toBe(0);
    expect(meta.aiSettingsUpdatedAt).toBe(0);
  });
});
