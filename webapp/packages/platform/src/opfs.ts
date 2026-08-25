/**
 * OPFS-backed filesystem.
 *
 * The Origin Private File System is where the imported FFG content has to
 * live: it is origin-private, handles large binaries, and offers synchronous
 * access inside a worker — which matters for the importer.
 *
 * Storage volume is the real risk. A full D2E plus MoM import is hundreds of
 * megabytes, and browser eviction under storage pressure would destroy an
 * hour of a user's setup. `requestPersistence` asks the browser not to, and
 * `estimate` surfaces the numbers so the UI can show them.
 */

import { basename, combine, dirname, resolve, segments } from './path.js'
import type { FileStat, FileSystem, ListOptions, StorageEstimate } from './filesystem.js'
import { NotFoundError, StorageFullError, splitLines } from './filesystem.js'

/**
 * The slice of the File System Access API this uses.
 *
 * Declared structurally rather than relying on DOM lib types, because the
 * core packages compile without them.
 */
export interface DirectoryHandleLike {
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<DirectoryHandleLike>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileHandleLike>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]>
  readonly kind: 'directory'
}

export interface FileHandleLike {
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number }>
  createWritable(options?: { keepExistingData?: boolean }): Promise<WritableLike>
  readonly kind: 'file'
}

export interface WritableLike {
  write(data: Uint8Array | { type: 'write'; position?: number; data: Uint8Array }): Promise<void>
  seek?(position: number): Promise<void>
  close(): Promise<void>
}

export interface StorageManagerLike {
  getDirectory(): Promise<DirectoryHandleLike>
  estimate?(): Promise<{ usage?: number; quota?: number }>
  persist?(): Promise<boolean>
  persisted?(): Promise<boolean>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Whether the current context can host an OPFS filesystem. */
export function opfsAvailable(storage: StorageManagerLike | undefined): boolean {
  return typeof storage?.getDirectory === 'function'
}

export class OpfsFileSystem implements FileSystem {
  constructor(private readonly storage: StorageManagerLike) {}

  private async root(): Promise<DirectoryHandleLike> {
    return this.storage.getDirectory()
  }

  /** Walks to a directory, optionally creating the missing parts. */
  private async directory(path: string, create: boolean): Promise<DirectoryHandleLike | null> {
    let handle = await this.root()
    for (const part of segments(resolve(path))) {
      try {
        handle = await handle.getDirectoryHandle(part, { create })
      } catch {
        return null
      }
    }
    return handle
  }

  private async file(path: string, create: boolean): Promise<FileHandleLike | null> {
    // A trailing separator names a directory, so it can never be a file.
    if (/[/\\]$/.test(path)) return null

    const resolved = resolve(path)
    const parent = await this.directory(dirname(resolved), create)
    if (parent === null) return null
    try {
      return await parent.getFileHandle(basename(resolved), { create })
    } catch {
      return null
    }
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null
  }

  async stat(path: string): Promise<FileStat | null> {
    const handle = await this.file(path, false)
    if (handle !== null) {
      const file = await handle.getFile()
      return { path, kind: 'file', size: file.size }
    }
    const dir = await this.directory(path, false)
    return dir === null ? null : { path, kind: 'directory', size: 0 }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const handle = await this.file(path, false)
    if (handle === null) throw new NotFoundError(path)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readBytes(path))
  }

  async readLines(path: string): Promise<string[]> {
    return splitLines(await this.readText(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const handle = await this.file(path, true)
    if (handle === null) throw new NotFoundError(path)
    try {
      const writable = await handle.createWritable()
      await writable.write(data)
      await writable.close()
    } catch (cause) {
      // The browser reports an exhausted quota as QuotaExceededError.
      if (isQuotaError(cause)) throw new StorageFullError(path, await this.estimate(), { cause })
      throw cause
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, encoder.encode(text))
  }

  async appendText(path: string, text: string): Promise<void> {
    const existing = (await this.exists(path)) ? await this.readText(path) : ''
    await this.writeText(path, existing + text)
  }

  async createDirectory(path: string): Promise<void> {
    await this.directory(path, true)
  }

  async list(path: string, options: ListOptions = {}): Promise<FileStat[]> {
    const dir = await this.directory(path, false)
    if (dir === null) return []

    const result: FileStat[] = []
    for await (const [name, handle] of dir.entries()) {
      const full = combine(path, name)
      if (handle.kind === 'file') {
        const file = await handle.getFile()
        result.push({ path: full, kind: 'file', size: file.size })
      } else {
        result.push({ path: full, kind: 'directory', size: 0 })
        if (options.recursive === true) result.push(...(await this.list(full, options)))
      }
    }
    return result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    const parent = await this.directory(dirname(path), false)
    if (parent === null) return
    try {
      await parent.removeEntry(basename(path), { recursive: true })
    } catch {
      // Absent is not an error, matching Directory.Delete's guarded callers.
    }
  }

  async copy(from: string, to: string): Promise<void> {
    await this.writeBytes(to, await this.readBytes(from))
  }

  async estimate(): Promise<StorageEstimate> {
    const raw = (await this.storage.estimate?.()) ?? {}
    const persistent = (await this.storage.persisted?.()) ?? false
    return {
      usage: raw.usage ?? null,
      quota: raw.quota ?? null,
      persistent,
    }
  }

  /**
   * Asks the browser to keep this origin's data through storage pressure.
   *
   * Worth doing before an import: without it a multi-hundred-megabyte content
   * set can be evicted, and the user cannot tell that from the app breaking.
   */
  async requestPersistence(): Promise<boolean> {
    return (await this.storage.persist?.()) ?? false
  }
}

function isQuotaError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = (error as { name?: unknown }).name
  return name === 'QuotaExceededError' || name === 'NS_ERROR_FILE_NO_DEVICE_SPACE'
}
