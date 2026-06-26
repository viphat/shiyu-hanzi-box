import { isReplicaFilename } from './vault';

export const SYNC_DIRNAME = '拾语汉字box-sync';
export const REPLICAS_DIRNAME = 'replicas';
export const MANIFEST_NAME = 'vault.json';

export interface SyncFs {
  listReplicas(): Promise<string[]>;
  readFile(name: string): Promise<string>;
  writeFile(name: string, contents: string): Promise<void>;
  readManifest(): Promise<string | null>;
  writeManifest(contents: string): Promise<void>;
}

export async function openSyncFs(parent: FileSystemDirectoryHandle): Promise<SyncFs> {
  const root = await parent.getDirectoryHandle(SYNC_DIRNAME, { create: true });
  const replicas = await root.getDirectoryHandle(REPLICAS_DIRNAME, { create: true });

  async function write(dir: FileSystemDirectoryHandle, name: string, contents: string) {
    const fileHandle = await dir.getFileHandle(name, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(contents);
    await writable.close(); // success only after close resolves
  }

  return {
    async listReplicas() {
      const names: string[] = [];
      for await (const [name, handle] of replicas.entries()) {
        if (handle.kind === 'file' && isReplicaFilename(name)) names.push(name);
      }
      return names.sort();
    },
    async readFile(name) {
      const handle = await replicas.getFileHandle(name);
      return (await handle.getFile()).text();
    },
    writeFile: (name, contents) => write(replicas, name, contents),
    async readManifest() {
      try {
        const handle = await root.getFileHandle(MANIFEST_NAME);
        return (await handle.getFile()).text();
      } catch {
        return null;
      }
    },
    writeManifest: (contents) => write(root, MANIFEST_NAME, contents),
  };
}

export class MemoryFs implements SyncFs {
  private replicas = new Map<string, string>();
  private manifest: string | null = null;

  seed(name: string, contents: string) {
    this.replicas.set(name, contents);
  }

  async listReplicas(): Promise<string[]> {
    return [...this.replicas.keys()].filter(isReplicaFilename).sort();
  }

  async readFile(name: string): Promise<string> {
    const value = this.replicas.get(name);
    if (value === undefined) throw new Error(`missing ${name}`);
    return value;
  }

  async writeFile(name: string, contents: string): Promise<void> {
    this.replicas.set(name, contents);
  }

  async readManifest(): Promise<string | null> {
    return this.manifest;
  }

  async writeManifest(contents: string): Promise<void> {
    this.manifest = contents;
  }
}
