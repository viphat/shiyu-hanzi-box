import { describe, expect, it, vi } from 'vitest';
import { reauthorizeFolder } from '../../lib/sync/connect';

// A minimal fake directory handle whose requestPermission result we control.
function fakeHandle(perm: string, label: string) {
  return {
    label,
    requestPermission: vi.fn(async () => perm),
  } as unknown as FileSystemDirectoryHandle;
}

describe('reauthorizeFolder', () => {
  it('re-grants silently via the stored handle when permission is granted', async () => {
    const stored = fakeHandle('granted', 'stored');
    const saveHandle = vi.fn(async () => {});
    const pickDirectory = vi.fn(async () => fakeHandle('granted', 'picked'));

    await reauthorizeFolder({
      loadHandle: async () => stored,
      saveHandle,
      pickDirectory,
    });

    // Saved the SAME stored handle; never opened the folder picker.
    expect(saveHandle).toHaveBeenCalledWith(stored);
    expect(pickDirectory).not.toHaveBeenCalled();
  });

  it('falls back to the folder picker when the stored handle does not grant', async () => {
    const stored = fakeHandle('prompt', 'stored');
    const picked = fakeHandle('granted', 'picked');
    const saveHandle = vi.fn(async () => {});
    const pickDirectory = vi.fn(async () => picked);

    await reauthorizeFolder({
      loadHandle: async () => stored,
      saveHandle,
      pickDirectory,
    });

    expect(pickDirectory).toHaveBeenCalledOnce();
    expect(saveHandle).toHaveBeenCalledWith(picked);
    expect(saveHandle).not.toHaveBeenCalledWith(stored);
  });

  it('falls back to the folder picker when no handle is stored', async () => {
    const picked = fakeHandle('granted', 'picked');
    const saveHandle = vi.fn(async () => {});
    const pickDirectory = vi.fn(async () => picked);

    await reauthorizeFolder({
      loadHandle: async () => null,
      saveHandle,
      pickDirectory,
    });

    expect(pickDirectory).toHaveBeenCalledOnce();
    expect(saveHandle).toHaveBeenCalledWith(picked);
  });

  it('propagates picker abort and saves nothing', async () => {
    const stored = fakeHandle('denied', 'stored');
    const saveHandle = vi.fn(async () => {});
    const abort = Object.assign(new Error('user aborted'), { name: 'AbortError' });
    const pickDirectory = vi.fn(async () => {
      throw abort;
    });

    await expect(
      reauthorizeFolder({ loadHandle: async () => stored, saveHandle, pickDirectory }),
    ).rejects.toBe(abort);
    expect(saveHandle).not.toHaveBeenCalled();
  });
});
