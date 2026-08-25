/**
 * A fake File System Access API, good enough to exercise `OpfsFileSystem`.
 *
 * OPFS only exists in a browser, so without this the browser implementation
 * would ship untested — the one that actually holds the user's imported
 * content. This models the handle tree, quota rejection and `persist()`.
 */

import type {
  DirectoryHandleLike,
  FileHandleLike,
  StorageManagerLike,
  WritableLike,
} from '../src/opfs.js'

class FakeFile implements FileHandleLike {
  readonly kind = 'file' as const
  data = new Uint8Array(0)

  constructor(private readonly store: FakeStorage) {}

  async getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number }> {
    const data = this.data
    return {
      size: data.byteLength,
      arrayBuffer: async () =>
        data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    }
  }

  createWritable(): Promise<WritableLike> {
    const store = this.store
    let pending = new Uint8Array(0)
    const commit = (data: Uint8Array) => {
      const delta = data.byteLength - this.data.byteLength
      if (store.quota !== null && store.used() + delta > store.quota) {
        const error = new Error('quota')
        error.name = 'QuotaExceededError'
        throw error
      }
      this.data = data
    }

    return Promise.resolve({
      write: (chunk) => {
        pending = chunk instanceof Uint8Array ? chunk : chunk.data
        return Promise.resolve()
      },
      close: () => {
        commit(pending)
        return Promise.resolve()
      },
    })
  }
}

class FakeDirectory implements DirectoryHandleLike {
  readonly kind = 'directory' as const
  readonly children = new Map<string, FakeDirectory | FakeFile>()

  constructor(private readonly store: FakeStorage) {}

  async getDirectoryHandle(
    name: string,
    options: { create?: boolean } = {},
  ): Promise<DirectoryHandleLike> {
    const existing = this.children.get(name)
    if (existing instanceof FakeDirectory) return existing
    if (existing !== undefined) throw new Error(`${name} is a file`)
    if (options.create !== true) throw new Error(`no such directory: ${name}`)

    const created = new FakeDirectory(this.store)
    this.children.set(name, created)
    return created
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileHandleLike> {
    const existing = this.children.get(name)
    if (existing instanceof FakeFile) return existing
    if (existing !== undefined) throw new Error(`${name} is a directory`)
    if (options.create !== true) throw new Error(`no such file: ${name}`)

    const created = new FakeFile(this.store)
    this.children.set(name, created)
    return created
  }

  async removeEntry(name: string): Promise<void> {
    if (!this.children.delete(name)) throw new Error(`no such entry: ${name}`)
  }

  async *entries(): AsyncIterableIterator<[string, DirectoryHandleLike | FileHandleLike]> {
    for (const [name, handle] of this.children) yield [name, handle]
  }

  bytes(): number {
    let total = 0
    for (const child of this.children.values()) {
      total += child instanceof FakeFile ? child.data.byteLength : child.bytes()
    }
    return total
  }
}

export class FakeStorage implements StorageManagerLike {
  private readonly rootHandle: FakeDirectory
  private isPersisted = false

  constructor(readonly quota: number | null = null) {
    this.rootHandle = new FakeDirectory(this)
  }

  async getDirectory(): Promise<DirectoryHandleLike> {
    return this.rootHandle
  }

  async estimate(): Promise<{ usage?: number; quota?: number }> {
    return this.quota === null ? { usage: this.used() } : { usage: this.used(), quota: this.quota }
  }

  async persist(): Promise<boolean> {
    this.isPersisted = true
    return true
  }

  async persisted(): Promise<boolean> {
    return this.isPersisted
  }

  used(): number {
    return this.rootHandle.bytes()
  }
}
