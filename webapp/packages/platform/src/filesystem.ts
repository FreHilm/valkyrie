/**
 * The virtual filesystem the ported code sits on.
 *
 * The Unity code assumes `System.IO` throughout: 187 `Path.` calls, 68
 * `Directory.` and 66 `File.` across 39 files. None of that exists in a
 * browser, and OPFS — the only place large imported content can live — is
 * asynchronous. So the interface is async, and the synchronous C# call sites
 * become awaited ones as each subsystem is ported.
 *
 * Three implementations share it: memory (tests), Node (tooling and the
 * differential harnesses) and OPFS (the browser).
 */

import { basename, combine, dirname, normalise, resolve, segments } from './path.js'

export interface FileStat {
  path: string
  kind: 'file' | 'directory'
  /** Bytes. 0 for a directory. */
  size: number
}

export interface ListOptions {
  /** Descend into subdirectories. */
  recursive?: boolean
}

export interface StorageEstimate {
  /** Bytes in use, when the host can report it. */
  usage: number | null
  /** Bytes available, when the host can report it. */
  quota: number | null
  /** Whether the browser has promised not to evict this origin's data. */
  persistent: boolean
}

/** Raised when a write cannot complete because the origin is out of room. */
export class StorageFullError extends Error {
  constructor(
    readonly path: string,
    readonly estimate: StorageEstimate | null,
    options?: { cause?: unknown },
  ) {
    const detail =
      estimate?.quota != null && estimate.usage != null
        ? ` (${estimate.usage} of ${estimate.quota} bytes used)`
        : ''
    super(`Out of storage writing ${path}${detail}`, options)
    this.name = 'StorageFullError'
  }
}

/** Raised when a path does not exist. */
export class NotFoundError extends Error {
  constructor(readonly path: string) {
    super(`No such file or directory: ${path}`)
    this.name = 'NotFoundError'
  }
}

export interface FileSystem {
  exists(path: string): Promise<boolean>
  stat(path: string): Promise<FileStat | null>

  readBytes(path: string): Promise<Uint8Array>
  readText(path: string): Promise<string>
  /**
   * Reads a text file split into lines.
   *
   * Splits on `\r\n`, `\r` and `\n` alike. That is deliberate: the Unity
   * `DictionaryI18n.AddDataFromFile` splits on `\r` only when the file
   * contains any `\r`, so a single `\n`-only line ending silently merges a key
   * into the previous value. Every shipped localization file parses
   * identically under this rule — verified by the i18n differential — while
   * the failure mode disappears.
   */
  readLines(path: string): Promise<string[]>

  writeBytes(path: string, data: Uint8Array): Promise<void>
  writeText(path: string, text: string): Promise<void>
  appendText(path: string, text: string): Promise<void>

  /** Creates a directory and any missing parents. */
  createDirectory(path: string): Promise<void>
  /** Lists a directory. Missing directories list as empty, as `GetFiles` does. */
  list(path: string, options?: ListOptions): Promise<FileStat[]>

  /** Deletes a file, or a directory and everything under it. No-op if absent. */
  remove(path: string): Promise<void>
  copy(from: string, to: string): Promise<void>

  estimate(): Promise<StorageEstimate>
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()

/** Splits text on any line ending. See `readLines`. */
export function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/)
}

// ---------------------------------------------------------------------------
// In-memory
// ---------------------------------------------------------------------------

/**
 * A filesystem held entirely in memory.
 *
 * Used by the core tests and as a stand-in wherever a real one is not
 * available. Directories are implicit: a file at `a/b/c` implies `a` and
 * `a/b`, plus any directory created explicitly.
 */
export class MemoryFileSystem implements FileSystem {
  private readonly files = new Map<string, Uint8Array>()
  private readonly directories = new Set<string>()

  /** Optional cap, so the out-of-space path can be exercised. */
  constructor(private readonly quota: number | null = null) {}

  private key(path: string): string {
    return resolve(normalise(path))
  }

  async exists(path: string): Promise<boolean> {
    return (await this.stat(path)) !== null
  }

  async stat(path: string): Promise<FileStat | null> {
    const key = this.key(path)
    const file = this.files.get(key)
    if (file !== undefined && !directoryOnly(path)) {
      return { path: key, kind: 'file', size: file.byteLength }
    }
    if (this.directories.has(key) || this.hasChildren(key)) {
      return { path: key, kind: 'directory', size: 0 }
    }
    return null
  }

  async readBytes(path: string): Promise<Uint8Array> {
    const data = this.files.get(this.key(path))
    if (data === undefined) throw new NotFoundError(path)
    return data
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readBytes(path))
  }

  async readLines(path: string): Promise<string[]> {
    return splitLines(await this.readText(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    const key = this.key(path)
    const existing = this.files.get(key)?.byteLength ?? 0
    if (this.quota !== null && this.used() - existing + data.byteLength > this.quota) {
      throw new StorageFullError(path, await this.estimate())
    }
    await this.createDirectory(dirname(key))
    this.files.set(key, data)
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, encoder.encode(text))
  }

  async appendText(path: string, text: string): Promise<void> {
    const existing = this.files.has(this.key(path)) ? await this.readText(path) : ''
    await this.writeText(path, existing + text)
  }

  async createDirectory(path: string): Promise<void> {
    const parts = segments(path)
    let current = normalise(path).startsWith('/') ? '/' : ''
    for (const part of parts) {
      current = combine(current, part)
      this.directories.add(this.key(current))
    }
  }

  async list(path: string, options: ListOptions = {}): Promise<FileStat[]> {
    const prefix = this.key(path)
    const base = prefix.length === 0 ? '' : `${prefix}/`
    const seen = new Map<string, FileStat>()

    const consider = (full: string, kind: 'file' | 'directory', size: number) => {
      if (!full.startsWith(base) || full === prefix) return
      const rest = full.slice(base.length)
      if (rest.length === 0) return

      if (options.recursive === true) {
        seen.set(full, { path: full, kind, size })
        return
      }
      // Only the immediate child.
      const slash = rest.indexOf('/')
      if (slash === -1) seen.set(full, { path: full, kind, size })
      else {
        const child = base + rest.slice(0, slash)
        seen.set(child, { path: child, kind: 'directory', size: 0 })
      }
    }

    for (const [full, data] of this.files) consider(full, 'file', data.byteLength)
    for (const full of this.directories) consider(full, 'directory', 0)

    return [...seen.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    const key = this.key(path)
    this.files.delete(key)
    this.directories.delete(key)
    const prefix = `${key}/`
    for (const existing of [...this.files.keys()]) {
      if (existing.startsWith(prefix)) this.files.delete(existing)
    }
    for (const existing of [...this.directories]) {
      if (existing.startsWith(prefix)) this.directories.delete(existing)
    }
  }

  async copy(from: string, to: string): Promise<void> {
    await this.writeBytes(to, await this.readBytes(from))
  }

  async estimate(): Promise<StorageEstimate> {
    return { usage: this.used(), quota: this.quota, persistent: true }
  }

  private used(): number {
    let total = 0
    for (const data of this.files.values()) total += data.byteLength
    return total
  }

  private hasChildren(key: string): boolean {
    if (key.length === 0) return true
    const prefix = `${key}/`
    for (const existing of this.files.keys()) if (existing.startsWith(prefix)) return true
    for (const existing of this.directories) if (existing.startsWith(prefix)) return true
    return false
  }
}

// ---------------------------------------------------------------------------
// Paths the app expects to exist
// ---------------------------------------------------------------------------

/**
 * The directory layout `ContentData`'s static path helpers describe.
 *
 * In the C# these read `Application.persistentDataPath`, `Game.AppData()` and
 * `Path.GetTempPath()`; here the roots are supplied so a test, a worker and
 * the app can each use their own.
 */
export interface StorageLayout {
  /** Where content packs shipped with the app live. */
  content: string
  /** Per-user application data. */
  appData: string
  /** Scratch space, cleared between sessions. */
  temp: string
}

export function defaultLayout(): StorageLayout {
  return { content: '/content', appData: '/appdata', temp: '/temp' }
}

export class StoragePaths {
  constructor(
    private readonly layout: StorageLayout,
    /** "D2E" or "MoM"; several paths are per-game. */
    private readonly gameType: string,
  ) {}

  get contentPath(): string {
    return combine(this.layout.content, '')
  }

  get gameTypePath(): string {
    return combine(this.layout.appData, this.gameType)
  }

  /** Where FFG-imported assets land. */
  get importPath(): string {
    return combine(this.gameTypePath, 'import')
  }

  /** Valkyrie's own UI text. `Game.cs:285` reads `<content>/../text`. */
  get uiTextPath(): string {
    return combine(dirname(this.layout.content), 'text')
  }

  get downloadPath(): string {
    return combine(this.layout.appData, 'Download')
  }

  get customContentPackPath(): string {
    return combine(this.downloadPath, 'ContentPacks')
  }

  get tempValkyriePath(): string {
    return combine(this.layout.temp, 'Valkyrie')
  }

  get loadPath(): string {
    return combine(this.tempValkyriePath, 'Load')
  }

  get preloadPath(): string {
    return combine(this.tempValkyriePath, 'Preload')
  }

  get loadQuestPath(): string {
    return combine(this.loadPath, 'quest')
  }

  get configPath(): string {
    return combine(this.layout.appData, 'config.ini')
  }
}

/** Removes the temp tree. Port of `ExtractManager.CleanTemp`. */
export async function cleanTemp(fs: FileSystem, paths: StoragePaths): Promise<void> {
  await fs.remove(paths.tempValkyriePath)
}

/**
 * Every file under `path` whose name matches, as `Directory.GetFiles` with
 * `SearchOption.AllDirectories` would.
 *
 * `pattern` accepts the `*.ext` form the C# call sites use.
 */
export async function findFiles(fs: FileSystem, path: string, pattern = '*'): Promise<string[]> {
  const entries = await fs.list(path, { recursive: true })
  const matcher = globToRegExp(pattern)
  return entries
    .filter((entry) => entry.kind === 'file' && matcher.test(basename(entry.path)))
    .map((entry) => entry.path)
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')
  return new RegExp(`^${escaped}$`)
}

/**
 * Whether a trailing separator restricts a path to directories.
 *
 * POSIX and .NET agree: `File.Exists("a/b.png/")` is false even when the file
 * is there. The differential harness for the multimedia resolver found the
 * in-memory filesystem disagreeing, which changed which candidate the
 * resolver returned.
 */
function directoryOnly(path: string): boolean {
  return /[/\\]$/.test(path)
}
