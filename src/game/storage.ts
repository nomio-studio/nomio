/**
 * Generic, path-based storage drivers.
 *
 * A driver maps a slash-separated string path (for example
 * `maps/<mapId>/saves/<saveId>/regions/0,0.nvrg`) to a byte blob. Everything
 * above this seam — the voxel format, the save system, the UI — is independent
 * of which browser API actually holds the bytes, so the storage backend can be
 * swapped without touching callers.
 *
 * The preferred backend is the Origin Private File System (OPFS); it falls back
 * to `localStorage` and finally to an in-memory buffer so the game still runs in
 * environments without durable storage.
 */

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface StorageDriver {
  /** Reads a file, or `null` when it does not exist. */
  read(path: string): Promise<Uint8Array | null>;
  /** Writes (creating or replacing) a file. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  /** Deletes a file; missing paths are ignored. */
  delete(path: string): Promise<void>;
  /** Recursively lists every file path beneath a directory. */
  list(prefix: string): Promise<string[]>;
  /** Removes a directory subtree; missing paths are ignored. */
  removeDirectory(prefix: string): Promise<void>;
}

const normalizePath = (path: string): string => path.replace(/^\/+/, "").replace(/\/+$/, "");

const isNotFoundError = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "NotFoundError";

/** Reads and JSON-parses a file, returning `null` when it is absent. */
export const readJson = async <T>(driver: StorageDriver, path: string): Promise<T | null> => {
  const bytes = await driver.read(path);
  if (!bytes) {
    return null;
  }
  return JSON.parse(decoder.decode(bytes)) as T;
};

/** Serializes a value to JSON and writes it. */
export const writeJson = async (
  driver: StorageDriver,
  path: string,
  value: unknown,
): Promise<void> => {
  await driver.write(path, encoder.encode(JSON.stringify(value)));
};

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
};

const fromBase64 = (value: string): Uint8Array => {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

/** Volatile driver used for tests and as a last resort. */
export class MemoryStorageDriver implements StorageDriver {
  private readonly files = new Map<string, Uint8Array>();

  public async read(path: string): Promise<Uint8Array | null> {
    const stored = this.files.get(normalizePath(path));
    return stored ? Uint8Array.from(stored) : null;
  }

  public async write(path: string, bytes: Uint8Array): Promise<void> {
    this.files.set(normalizePath(path), Uint8Array.from(bytes));
  }

  public async delete(path: string): Promise<void> {
    this.files.delete(normalizePath(path));
  }

  public async list(prefix: string): Promise<string[]> {
    const base = normalizePath(prefix);
    const results: string[] = [];
    for (const path of this.files.keys()) {
      if (base === "" || path === base || path.startsWith(`${base}/`)) {
        results.push(path);
      }
    }
    return results.sort();
  }

  public async removeDirectory(prefix: string): Promise<void> {
    const base = normalizePath(prefix);
    for (const path of await this.list(base)) {
      this.files.delete(path);
    }
  }
}

/**
 * Last-resort durable driver for environments without OPFS. Paths become
 * prefixed `localStorage` keys and bytes are base64 encoded, which is compact
 * enough for the sparse, few-hundred-byte save files the game writes.
 */
export class LocalStorageStorageDriver implements StorageDriver {
  public constructor(private readonly prefix = "nomio:fs:") {}

  public async read(path: string): Promise<Uint8Array | null> {
    const value = localStorage.getItem(this.key(path));
    return value ? fromBase64(value) : null;
  }

  public async write(path: string, bytes: Uint8Array): Promise<void> {
    localStorage.setItem(this.key(path), toBase64(bytes));
  }

  public async delete(path: string): Promise<void> {
    localStorage.removeItem(this.key(path));
  }

  public async list(prefix: string): Promise<string[]> {
    const base = normalizePath(prefix);
    const results: string[] = [];
    for (const key of this.keys()) {
      const path = key.slice(this.prefix.length);
      if (base === "" || path === base || path.startsWith(`${base}/`)) {
        results.push(path);
      }
    }
    return results.sort();
  }

  public async removeDirectory(prefix: string): Promise<void> {
    for (const path of await this.list(prefix)) {
      localStorage.removeItem(this.key(path));
    }
  }

  private key(path: string): string {
    return this.prefix + normalizePath(path);
  }

  private keys(): string[] {
    const keys: string[] = [];
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(this.prefix)) {
        keys.push(key);
      }
    }
    return keys;
  }
}

/**
 * Durable driver over the Origin Private File System. Path segments become
 * nested directories, and `createWritable` replaces a file on close, so an
 * edit only rewrites the small region file it touched.
 */
export class OpfsStorageDriver implements StorageDriver {
  private root: Promise<FileSystemDirectoryHandle> | null = null;

  public async read(path: string): Promise<Uint8Array | null> {
    try {
      const { directory, name } = await this.parent(path);
      const handle = await directory.getFileHandle(name);
      const file = await handle.getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch (error) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  public async write(path: string, bytes: Uint8Array): Promise<void> {
    const { directory, name } = await this.parent(path, true);
    const handle = await directory.getFileHandle(name, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(new Uint8Array(bytes));
      await writable.close();
    } catch (error) {
      await writable.abort().catch(() => undefined);
      throw error;
    }
  }

  public async delete(path: string): Promise<void> {
    try {
      const { directory, name } = await this.parent(path);
      await directory.removeEntry(name);
    } catch (error) {
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  public async list(prefix: string): Promise<string[]> {
    const base = normalizePath(prefix);
    const directory = await this.directory(base, false).catch(() => null);
    if (!directory) {
      return [];
    }
    const results: string[] = [];
    await this.walk(directory, base, results);
    return results.sort();
  }

  public async removeDirectory(prefix: string): Promise<void> {
    const base = normalizePath(prefix);
    if (!base) {
      const root = await this.open();
      const names: string[] = [];
      for await (const name of root.keys()) {
        names.push(name);
      }
      for (const name of names) {
        await root.removeEntry(name, { recursive: true });
      }
      return;
    }

    try {
      const { directory, name } = await this.parent(base);
      await directory.removeEntry(name, { recursive: true });
    } catch (error) {
      // Either an ancestor directory or the target itself was already absent.
      if (!isNotFoundError(error)) {
        throw error;
      }
    }
  }

  private async walk(
    directory: FileSystemDirectoryHandle,
    base: string,
    results: string[],
  ): Promise<void> {
    for await (const [name, handle] of directory.entries()) {
      const path = `${base}/${name}`;
      if (handle.kind === "file") {
        results.push(path);
      } else {
        await this.walk(handle, path, results);
      }
    }
  }

  private async parent(
    path: string,
    create = false,
  ): Promise<{ directory: FileSystemDirectoryHandle; name: string }> {
    const normalized = normalizePath(path);
    const index = normalized.lastIndexOf("/");
    const directoryPath = index < 0 ? "" : normalized.slice(0, index);
    const name = index < 0 ? normalized : normalized.slice(index + 1);
    return { directory: await this.directory(directoryPath, create), name };
  }

  private async directory(path: string, create: boolean): Promise<FileSystemDirectoryHandle> {
    let directory = await this.open();
    for (const segment of normalizePath(path).split("/")) {
      if (segment) {
        directory = await directory.getDirectoryHandle(segment, { create });
      }
    }
    return directory;
  }

  private open(): Promise<FileSystemDirectoryHandle> {
    if (this.root === null) {
      this.root = navigator.storage.getDirectory();
    }
    return this.root;
  }
}

/** True when the browser exposes the Origin Private File System. */
export const supportsOpfs = (): boolean =>
  typeof navigator !== "undefined" &&
  typeof navigator.storage?.getDirectory === "function" &&
  (typeof isSecureContext === "undefined" || isSecureContext);

/** Picks the most durable driver the environment supports. */
export const createDefaultStorageDriver = (): StorageDriver => {
  if (supportsOpfs()) {
    return new OpfsStorageDriver();
  }
  if (typeof localStorage !== "undefined") {
    return new LocalStorageStorageDriver();
  }
  return new MemoryStorageDriver();
};
