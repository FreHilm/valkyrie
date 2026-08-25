/**
 * Reading a directory the user picked, as an asset source.
 *
 * The import needs the Unity data folder of a licensed install. In the Unity
 * build that is a path it already knows; in a browser the only way to read
 * outside the origin's own storage is a directory the user hands over through
 * `showDirectoryPicker`, which grants read access to that directory alone.
 *
 * Nothing here writes, and nothing here leaves the machine: the handle is used
 * to read asset files, which the import decodes into browser storage.
 */

/** The slice of `FileSystemDirectoryHandle` this needs. */
export interface PickedDirectory {
  name: string
  entries(): AsyncIterableIterator<[string, PickedEntry]>
  getDirectoryHandle(name: string): Promise<PickedDirectory>
  getFileHandle(name: string): Promise<PickedFile>
}

export interface PickedFile {
  kind: 'file'
  getFile(): Promise<{ arrayBuffer(): Promise<ArrayBuffer>; size: number }>
}

export type PickedEntry = PickedFile | (PickedDirectory & { kind: 'directory' })

export interface PickedSourceOptions {
  /** Only files whose name matches are listed. */
  accept?: (name: string) => boolean
  /** Descend into subdirectories. Unity data folders are one level for assets. */
  recursive?: boolean
}

/**
 * An `AssetSource` over a picked directory.
 *
 * Names are relative to the picked directory, so a caller sees the same shape
 * it would from a path on disk.
 */
export class PickedDirectorySource {
  private listing: string[] | null = null

  constructor(
    private readonly directory: PickedDirectory,
    private readonly options: PickedSourceOptions = {},
  ) {}

  /** The directory's own name, for telling the user what was opened. */
  get name(): string {
    return this.directory.name
  }

  async list(): Promise<string[]> {
    if (this.listing !== null) return this.listing
    const found: string[] = []
    await this.walk(this.directory, '', found)
    found.sort()
    this.listing = found
    return found
  }

  private async walk(directory: PickedDirectory, prefix: string, into: string[]): Promise<void> {
    for await (const [name, entry] of directory.entries()) {
      const path = prefix.length === 0 ? name : `${prefix}/${name}`
      if (entry.kind === 'directory') {
        if (this.options.recursive === true) await this.walk(entry, path, into)
        continue
      }
      if (this.options.accept?.(name) === false) continue
      into.push(path)
    }
  }

  async read(name: string): Promise<Uint8Array> {
    const parts = name.split('/')
    const fileName = parts.pop()
    if (fileName === undefined) throw new Error(`Not a file: ${name}`)

    let directory = this.directory
    for (const part of parts) directory = await directory.getDirectoryHandle(part)

    const handle = await directory.getFileHandle(fileName)
    const file = await handle.getFile()
    return new Uint8Array(await file.arrayBuffer())
  }

  /** Total bytes, for showing how much is about to be read. */
  async size(): Promise<number> {
    let total = 0
    for (const name of await this.list()) {
      const parts = name.split('/')
      const fileName = parts.pop()
      if (fileName === undefined) continue
      let directory = this.directory
      for (const part of parts) directory = await directory.getDirectoryHandle(part)
      const handle = await directory.getFileHandle(fileName)
      total += (await handle.getFile()).size
    }
    return total
  }
}

/** Whether this browser can open a directory at all. */
export function canPickDirectory(): boolean {
  return typeof globalThis !== 'undefined' && 'showDirectoryPicker' in globalThis
}

/**
 * The Unity asset files an FFG import reads.
 *
 * Everything else in a data folder — the executable, the player settings, the
 * managed DLLs — is of no interest, and listing it only makes the import look
 * bigger than it is.
 */
export function isUnityAsset(name: string): boolean {
  if (name.endsWith('.resS') || name.endsWith('.resource')) return true
  if (name === 'resources.assets' || name === 'globalgamemanagers') return true
  if (/^level\d+$/.test(name)) return true
  if (/^sharedassets\d+\.assets$/.test(name)) return true
  return name.endsWith('.assets')
}
