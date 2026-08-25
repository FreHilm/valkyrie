/**
 * Node-backed filesystem.
 *
 * Not shipped to the browser. It exists so the core tests, the differential
 * harnesses and the importer tooling can run against a real filesystem
 * without one of them needing a browser.
 */

import { constants } from 'node:fs'
import {
  access,
  appendFile,
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat as nodeStat,
  statfs,
  writeFile,
} from 'node:fs/promises'

import { basename, combine, dirname, normalise, resolve } from './path.js'
import type { FileStat, FileSystem, ListOptions, StorageEstimate } from './filesystem.js'
import { NotFoundError, StorageFullError, splitLines } from './filesystem.js'

const decoder = new TextDecoder()

export class NodeFileSystem implements FileSystem {
  /** Every path is resolved under `root`, so tests cannot escape their sandbox. */
  constructor(private readonly root: string = '') {}

  /**
   * Maps a virtual path under `root`.
   *
   * The leading separator has to be stripped first: `combine` follows
   * `Path.Combine`, where a rooted second segment *replaces* the first — so
   * combining a root with "/a.txt" would resolve to the real filesystem root
   * and escape the sandbox entirely. `resolve` then collapses any `..`, so a
   * caller cannot climb out either.
   */
  private real(path: string): string {
    // Resolved as if rooted, so a leading ".." is dropped rather than kept:
    // resolve("../../x") is "../../x", which would still escape once joined.
    const relative = resolve(`/${normalise(path)}`).replace(/^\/+/, '')
    const inside = this.root.length === 0 ? relative : combine(this.root, relative)
    // resolve() drops a trailing separator; the OS treats it as "directory
    // only", so it has to be put back for the lookup to agree.
    return /[/\\]$/.test(path) ? `${inside}/` : inside
  }

  async exists(path: string): Promise<boolean> {
    try {
      await access(this.real(path), constants.F_OK)
      return true
    } catch {
      return false
    }
  }

  async stat(path: string): Promise<FileStat | null> {
    try {
      const info = await nodeStat(this.real(path))
      return {
        path: normalise(path),
        kind: info.isDirectory() ? 'directory' : 'file',
        size: info.isDirectory() ? 0 : info.size,
      }
    } catch {
      return null
    }
  }

  async readBytes(path: string): Promise<Uint8Array> {
    try {
      return new Uint8Array(await readFile(this.real(path)))
    } catch {
      throw new NotFoundError(path)
    }
  }

  async readText(path: string): Promise<string> {
    return decoder.decode(await this.readBytes(path))
  }

  async readLines(path: string): Promise<string[]> {
    return splitLines(await this.readText(path))
  }

  async writeBytes(path: string, data: Uint8Array): Promise<void> {
    await this.createDirectory(dirname(path))
    try {
      await writeFile(this.real(path), data)
    } catch (cause) {
      if (isNoSpace(cause)) throw new StorageFullError(path, await this.estimate(), { cause })
      throw cause
    }
  }

  async writeText(path: string, text: string): Promise<void> {
    await this.writeBytes(path, new TextEncoder().encode(text))
  }

  async appendText(path: string, text: string): Promise<void> {
    await this.createDirectory(dirname(path))
    try {
      await appendFile(this.real(path), text)
    } catch (cause) {
      if (isNoSpace(cause)) throw new StorageFullError(path, await this.estimate(), { cause })
      throw cause
    }
  }

  async createDirectory(path: string): Promise<void> {
    if (path.length === 0) return
    await mkdir(this.real(path), { recursive: true })
  }

  async list(path: string, options: ListOptions = {}): Promise<FileStat[]> {
    let entries
    try {
      entries = await readdir(this.real(path), { withFileTypes: true })
    } catch {
      // A missing directory lists as empty, matching Directory.GetFiles's
      // guarded call sites rather than its actual throw.
      return []
    }

    const result: FileStat[] = []
    for (const entry of entries) {
      const full = combine(path, entry.name)
      if (entry.isDirectory()) {
        result.push({ path: full, kind: 'directory', size: 0 })
        if (options.recursive === true) result.push(...(await this.list(full, options)))
      } else {
        const info = await nodeStat(this.real(full))
        result.push({ path: full, kind: 'file', size: info.size })
      }
    }
    return result.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  }

  async remove(path: string): Promise<void> {
    await rm(this.real(path), { recursive: true, force: true })
  }

  async copy(from: string, to: string): Promise<void> {
    await this.createDirectory(dirname(to))
    await copyFile(this.real(from), this.real(to))
  }

  async estimate(): Promise<StorageEstimate> {
    try {
      const info = await statfs(this.real('') || '.')
      const quota = Number(info.blocks) * Number(info.bsize)
      const free = Number(info.bavail) * Number(info.bsize)
      return { usage: quota - free, quota, persistent: true }
    } catch {
      return { usage: null, quota: null, persistent: true }
    }
  }
}

function isNoSpace(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const code = (error as { code?: unknown }).code
  return code === 'ENOSPC' || code === 'EDQUOT'
}

export { basename }
