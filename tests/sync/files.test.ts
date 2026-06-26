import { describe, expect, it } from 'vitest';
import { MemoryFs } from '../../lib/sync/files';

describe('MemoryFs', () => {
  it('lists only valid replica filenames', async () => {
    const fs = new MemoryFs();
    fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu', 'a');
    fs.seed('01J0AZ5K2YJ3M4N5P6Q7R8S9TV (1).shiyu', 'conflict');
    fs.seed('notes.txt', 'x');
    expect(await fs.listReplicas()).toEqual(['01J0AZ5K2YJ3M4N5P6Q7R8S9TV.shiyu']);
  });

  it('round-trips writes and reads', async () => {
    const fs = new MemoryFs();
    await fs.writeFile('01J0AZ5K2YJ3M4N5P6Q7R8S9TW.shiyu', 'payload');
    expect(await fs.readFile('01J0AZ5K2YJ3M4N5P6Q7R8S9TW.shiyu')).toBe('payload');
  });

  it('reads and writes the manifest', async () => {
    const fs = new MemoryFs();
    expect(await fs.readManifest()).toBeNull();
    await fs.writeManifest('{}');
    expect(await fs.readManifest()).toBe('{}');
  });
});
