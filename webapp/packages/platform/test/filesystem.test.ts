/**
 * Tests for the virtual filesystem (T-011).
 *
 * The three implementations are run through the same suite, so a behaviour
 * that only holds in memory cannot pass unnoticed. OPFS runs against a fake
 * File System Access API — without it the browser implementation, the one
 * that actually holds the user's imported content, would ship untested.
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

import {
  MemoryFileSystem,
  StorageFullError,
  NotFoundError,
  StoragePaths,
  cleanTemp,
  defaultLayout,
  findFiles,
  splitLines,
} from '../src/filesystem.js'
import type { FileSystem } from '../src/filesystem.js'
import { OpfsFileSystem, opfsAvailable } from '../src/opfs.js'
import { NodeFileSystem } from '../src/node.js'
import {
  basename,
  basenameWithoutExtension,
  combine,
  dirname,
  extname,
  isInside,
  normalise,
  resolve,
  segments,
} from '../src/path.js'
import { FakeStorage } from './fakeOpfs.js'

describe('path helpers', () => {
  it('normalises Windows separators', () => {
    expect(normalise('a\\b\\c')).toBe('a/b/c')
    expect(normalise('a//b')).toBe('a/b')
  })

  it('combines the way Path.Combine does', () => {
    expect(combine('a', 'b')).toBe('a/b')
    expect(combine('a/', 'b')).toBe('a/b')
    expect(combine('a', '')).toBe('a')
    expect(combine('', 'b')).toBe('b')
    expect(combine('a', '/b')).toBe('/b')
    expect(combine('a', 'b', 'c')).toBe('a/b/c')
  })

  it('splits a path into directory and name', () => {
    expect(dirname('/a/b/c.txt')).toBe('/a/b')
    expect(basename('/a/b/c.txt')).toBe('c.txt')
    expect(dirname('c.txt')).toBe('')
    expect(dirname('/c.txt')).toBe('/')
    expect(basename('/a/b/')).toBe('b')
  })

  it('reads extensions', () => {
    expect(extname('a/b.png')).toBe('.png')
    expect(extname('a/b')).toBe('')
    expect(extname('a/.hidden')).toBe('')
    expect(extname('a/b.tar.gz')).toBe('.gz')
    expect(basenameWithoutExtension('a/b.png')).toBe('b')
    expect(basenameWithoutExtension('a/b')).toBe('b')
  })

  it('lists segments without empties', () => {
    expect(segments('/a//b/')).toEqual(['a', 'b'])
  })

  it('resolves . and ..', () => {
    expect(resolve('/a/b/../c')).toBe('/a/c')
    expect(resolve('/a/./b')).toBe('/a/b')
    // A rooted path cannot climb above its root.
    expect(resolve('/a/../../b')).toBe('/b')
    expect(resolve('../a')).toBe('../a')
  })

  it('detects containment, which the extractor relies on', () => {
    expect(isInside('/base', '/base/a/b')).toBe(true)
    expect(isInside('/base', '/base')).toBe(true)
    // The classic prefix trap: /basement is not inside /base.
    expect(isInside('/base', '/basement/a')).toBe(false)
    expect(isInside('/base', '/other')).toBe(false)
  })
})

describe('splitLines', () => {
  it('splits on every line ending alike', () => {
    // The Unity reader splits on \r only when the file contains any \r, so a
    // lone \n silently merges a key into the previous value.
    expect(splitLines('a\r\nb\rc\nd')).toEqual(['a', 'b', 'c', 'd'])
  })
})

// ---------------------------------------------------------------------------
// The shared suite, run against every implementation
// ---------------------------------------------------------------------------

const tempRoots: string[] = []

const IMPLEMENTATIONS: [name: string, make: () => Promise<FileSystem>][] = [
  ['memory', async () => new MemoryFileSystem()],
  [
    'node',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'valkyrie-fs-'))
      tempRoots.push(root)
      return new NodeFileSystem(root)
    },
  ],
  ['opfs', async () => new OpfsFileSystem(new FakeStorage())],
]

afterAll(async () => {
  for (const root of tempRoots) await rm(root, { recursive: true, force: true })
})

describe.each(IMPLEMENTATIONS)('FileSystem: %s', (_name, make) => {
  let fs: FileSystem

  beforeEach(async () => {
    fs = await make()
  })

  it('round-trips text', async () => {
    await fs.writeText('/a/b.txt', 'hello')

    expect(await fs.readText('/a/b.txt')).toBe('hello')
    expect(await fs.exists('/a/b.txt')).toBe(true)
  })

  it('round-trips bytes', async () => {
    const data = new Uint8Array([1, 2, 3, 250])
    await fs.writeBytes('/bin.dat', data)

    expect([...(await fs.readBytes('/bin.dat'))]).toEqual([1, 2, 3, 250])
  })

  it('creates parent directories on write', async () => {
    await fs.writeText('/deep/nested/path/file.txt', 'x')

    expect((await fs.stat('/deep/nested'))?.kind).toBe('directory')
  })

  it('reports a missing path as absent rather than throwing', async () => {
    expect(await fs.exists('/nope')).toBe(false)
    expect(await fs.stat('/nope')).toBeNull()
  })

  it('throws NotFoundError when reading something absent', async () => {
    await expect(fs.readBytes('/nope')).rejects.toBeInstanceOf(NotFoundError)
  })

  it('reports file size', async () => {
    await fs.writeText('/a.txt', 'hello')

    expect((await fs.stat('/a.txt'))?.size).toBe(5)
  })

  it('appends to a file, creating it if needed', async () => {
    await fs.appendText('/log.txt', 'one\n')
    await fs.appendText('/log.txt', 'two\n')

    expect(await fs.readText('/log.txt')).toBe('one\ntwo\n')
  })

  it('splits lines on any ending', async () => {
    await fs.writeText('/lines.txt', 'a\r\nb\rc\nd')

    expect(await fs.readLines('/lines.txt')).toEqual(['a', 'b', 'c', 'd'])
  })

  it('lists immediate children only by default', async () => {
    await fs.writeText('/dir/a.txt', '1')
    await fs.writeText('/dir/sub/b.txt', '2')

    const listed = await fs.list('/dir')
    expect(listed.map((e) => e.path).sort()).toEqual(['/dir/a.txt', '/dir/sub'])
  })

  it('lists recursively when asked', async () => {
    await fs.writeText('/dir/a.txt', '1')
    await fs.writeText('/dir/sub/b.txt', '2')

    const listed = await fs.list('/dir', { recursive: true })
    expect(
      listed
        .filter((e) => e.kind === 'file')
        .map((e) => e.path)
        .sort(),
    ).toEqual(['/dir/a.txt', '/dir/sub/b.txt'])
  })

  it('lists a missing directory as empty, matching the C# call sites', async () => {
    expect(await fs.list('/nothing/here')).toEqual([])
  })

  it('removes a file', async () => {
    await fs.writeText('/a.txt', 'x')
    await fs.remove('/a.txt')

    expect(await fs.exists('/a.txt')).toBe(false)
  })

  it('removes a directory and everything under it', async () => {
    await fs.writeText('/tree/a.txt', '1')
    await fs.writeText('/tree/sub/b.txt', '2')
    await fs.remove('/tree')

    expect(await fs.exists('/tree/sub/b.txt')).toBe(false)
    expect(await fs.exists('/tree')).toBe(false)
  })

  it('removing something absent is a no-op', async () => {
    await expect(fs.remove('/nothing')).resolves.toBeUndefined()
  })

  it('copies a file', async () => {
    await fs.writeText('/from.txt', 'content')
    await fs.copy('/from.txt', '/to/there.txt')

    expect(await fs.readText('/to/there.txt')).toBe('content')
  })

  it('creates a directory tree', async () => {
    await fs.createDirectory('/x/y/z')

    expect((await fs.stat('/x/y/z'))?.kind).toBe('directory')
  })

  it('overwrites an existing file', async () => {
    await fs.writeText('/a.txt', 'first')
    await fs.writeText('/a.txt', 'second')

    expect(await fs.readText('/a.txt')).toBe('second')
  })

  it('reports a storage estimate', async () => {
    const estimate = await fs.estimate()

    expect(estimate).toHaveProperty('usage')
    expect(estimate).toHaveProperty('quota')
    expect(estimate).toHaveProperty('persistent')
  })

  it('finds files recursively by pattern', async () => {
    await fs.writeText('/packs/a/content_pack.ini', '1')
    await fs.writeText('/packs/b/content_pack.ini', '2')
    await fs.writeText('/packs/b/other.txt', '3')

    expect((await findFiles(fs, '/packs', 'content_pack.ini')).sort()).toEqual([
      '/packs/a/content_pack.ini',
      '/packs/b/content_pack.ini',
    ])
    expect((await findFiles(fs, '/packs', '*.ini')).length).toBe(2)
    expect((await findFiles(fs, '/packs')).length).toBe(3)
  })

  // Both rules were found by the multimedia differential harness: the C# runs
  // on a real filesystem, and the port has to agree with one.
  it('resolves . and .. in a lookup, as a real filesystem does', async () => {
    const fs = await make()
    await fs.writeText('/a/b/tile.png', 'x')

    expect(await fs.exists('/a/./b/tile.png')).toBe(true)
    expect(await fs.exists('/a/b/../b/tile.png')).toBe(true)
    expect(await fs.readText('/a/./b/tile.png')).toBe('x')
  })

  it('refuses a file lookup that carries a trailing separator', async () => {
    const fs = await make()
    await fs.writeText('/a/tile.png', 'x')
    await fs.createDirectory('/a/sub')

    // File.Exists("a/tile.png/") is false on POSIX and on .NET alike.
    expect(await fs.exists('/a/tile.png/')).toBe(false)
    expect(await fs.exists('/a/sub/')).toBe(true)
  })
})

describe('quota handling', () => {
  it('memory reports StorageFullError past its cap', async () => {
    const fs = new MemoryFileSystem(10)
    await fs.writeText('/small.txt', '12345')

    await expect(fs.writeText('/big.txt', '1234567890')).rejects.toBeInstanceOf(StorageFullError)
  })

  it('opfs turns QuotaExceededError into StorageFullError', async () => {
    const fs = new OpfsFileSystem(new FakeStorage(10))
    await fs.writeText('/small.txt', '12345')

    const failure = fs.writeText('/big.txt', '1234567890')
    await expect(failure).rejects.toBeInstanceOf(StorageFullError)
  })

  it('names the path and the numbers, so the UI can explain it', async () => {
    const fs = new MemoryFileSystem(4)

    await expect(fs.writeText('/x.txt', 'toolong')).rejects.toThrow(
      /Out of storage writing \/x\.txt/,
    )
    await expect(fs.writeText('/x.txt', 'toolong')).rejects.toThrow(/0 of 4 bytes used/)
  })

  it('replacing a file counts only the difference', async () => {
    const fs = new MemoryFileSystem(10)
    await fs.writeText('/a.txt', '1234567890')

    // Same size, so it fits even though the quota is exactly full.
    await expect(fs.writeText('/a.txt', '0987654321')).resolves.toBeUndefined()
  })
})

describe('OPFS specifics', () => {
  it('detects whether the host can provide OPFS', () => {
    expect(opfsAvailable(new FakeStorage())).toBe(true)
    expect(opfsAvailable(undefined)).toBe(false)
    expect(opfsAvailable({} as never)).toBe(false)
  })

  it('requests persistence, which guards against eviction', async () => {
    const storage = new FakeStorage()
    const fs = new OpfsFileSystem(storage)

    expect((await fs.estimate()).persistent).toBe(false)
    expect(await fs.requestPersistence()).toBe(true)
    expect((await fs.estimate()).persistent).toBe(true)
  })

  it('reports usage against the quota', async () => {
    const fs = new OpfsFileSystem(new FakeStorage(1000))
    await fs.writeText('/a.txt', '12345')

    expect(await fs.estimate()).toEqual({ usage: 5, quota: 1000, persistent: false })
  })
})

describe('StoragePaths', () => {
  const paths = new StoragePaths(defaultLayout(), 'D2E')

  it('describes the layout the C# path helpers assume', () => {
    expect(paths.gameTypePath).toBe('/appdata/D2E')
    expect(paths.importPath).toBe('/appdata/D2E/import')
    expect(paths.downloadPath).toBe('/appdata/Download')
    expect(paths.customContentPackPath).toBe('/appdata/Download/ContentPacks')
    expect(paths.tempValkyriePath).toBe('/temp/Valkyrie')
    expect(paths.loadPath).toBe('/temp/Valkyrie/Load')
    expect(paths.loadQuestPath).toBe('/temp/Valkyrie/Load/quest')
    expect(paths.preloadPath).toBe('/temp/Valkyrie/Preload')
    expect(paths.configPath).toBe('/appdata/config.ini')
  })

  it('is per game type', () => {
    expect(new StoragePaths(defaultLayout(), 'MoM').importPath).toBe('/appdata/MoM/import')
  })

  it('cleanTemp removes the whole temp tree', async () => {
    const fs = new MemoryFileSystem()
    await fs.writeText('/temp/Valkyrie/Load/quest/a.ini', 'x')

    await cleanTemp(fs, paths)

    expect(await fs.exists('/temp/Valkyrie')).toBe(false)
  })
})

describe('NodeFileSystem sandboxing', () => {
  it('keeps every path inside its root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'valkyrie-sandbox-'))
    tempRoots.push(root)
    const fs = new NodeFileSystem(root)

    // An absolute virtual path must not reach the real filesystem root, and
    // '..' must not climb above the sandbox.
    await fs.writeText('/a.txt', 'inside')
    await fs.writeText('../../escape.txt', 'also inside')

    expect(await fs.readText('/a.txt')).toBe('inside')
    expect(await fs.readText('escape.txt')).toBe('also inside')

    const { readdir } = await import('node:fs/promises')
    expect((await readdir(root)).sort()).toEqual(['a.txt', 'escape.txt'])
  })
})
