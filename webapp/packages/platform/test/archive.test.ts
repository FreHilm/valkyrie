/**
 * Tests for archive extraction (T-012).
 *
 * Migrated from `ZipSlipTests.cs` and extended to cover the selective modes,
 * which the C# leaves unguarded — a real hole, since these archives are
 * downloaded from other people's repositories.
 */

import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'

import {
  ExtractMode,
  destinationInside,
  extract,
  extractEntries,
  extractStream,
  questImageFromIni,
  readArchive,
} from '../src/archive.js'
import type { ArchiveEntry } from '../src/archive.js'
import { MemoryFileSystem } from '../src/filesystem.js'

const encoder = new TextEncoder()
const entry = (name: string, text = name): ArchiveEntry => ({
  name,
  data: encoder.encode(text),
})

const zipOf = (files: Record<string, string>): Uint8Array =>
  zipSync(
    Object.fromEntries(Object.entries(files).map(([name, text]) => [name, encoder.encode(text)])),
  )

describe('destinationInside', () => {
  it('accepts an ordinary entry', () => {
    expect(destinationInside('/target', 'a/b.txt')).toBe(true)
  })

  it('refuses a parent traversal', () => {
    expect(destinationInside('/target', '../evil.txt')).toBe(false)
    expect(destinationInside('/target', 'a/../../evil.txt')).toBe(false)
    expect(destinationInside('/target', '../../../etc/passwd')).toBe(false)
  })

  it('refuses an absolute entry name', () => {
    expect(destinationInside('/target', '/etc/passwd')).toBe(false)
  })

  it('refuses a Windows-separator traversal', () => {
    // Entries written on Windows store backslashes.
    expect(destinationInside('/target', '..\\evil.txt')).toBe(false)
  })

  it('does not fall for the sibling-prefix trap', () => {
    // /targetmalicious is not inside /target, even though the string starts
    // with it. The C# guard gets this right by appending a separator first.
    expect(destinationInside('/target', '../targetmalicious/evil.txt')).toBe(false)
  })
})

describe('ZipSlipTests.cs', () => {
  it('ZipManager_ExtractFull_MitigatesZipSlip', async () => {
    const fs = new MemoryFileSystem()
    const result = await extract(
      fs,
      zipOf({ 'good.txt': 'good', '../evil.txt': 'evil' }),
      '/extract',
      ExtractMode.FULL,
    )

    expect(await fs.readText('/extract/good.txt')).toBe('good')
    expect(result.blocked).toEqual(['../evil.txt'])
    expect(await fs.exists('/evil.txt')).toBe(false)
  })
})

describe('the traversal guard covers every mode (DEVIATION)', () => {
  // The C# checks destinations only in EXTRACT_FULL. The selective modes call
  // ExtractSelectedEntries with no check, so an entry named ../../quest.ini
  // matches "name = *quest.ini" and lands outside the target.
  it.each([
    [ExtractMode.INI_TXT, '../../quest.ini'],
    [ExtractMode.INI_TXT_PIC, '../../quest.ini'],
    [ExtractMode.SAVE_INI_PIC, '../../save.ini'],
    [ExtractMode.SAVE_INI_PIC, '../evil/quest.ini'],
  ])('%s refuses %s', async (mode, name) => {
    const fs = new MemoryFileSystem()
    const result = await extractEntries(fs, [entry(name), entry('quest.ini')], '/target', mode)

    expect(result.blocked).toContain(name)
    expect(await fs.exists('/quest.ini')).toBe(false)
  })
})

describe('extract modes', () => {
  const pack = (): ArchiveEntry[] => [
    entry('quest.ini', '[Quest]\nimage=cover.png\nname=Test'),
    entry('Localization.English.txt', '.,English\nKEY,value'),
    entry('Localization.German.txt', '.,German\nKEY,wert'),
    entry('cover.png', 'PNG'),
    entry('events.ini', '[EventA]'),
    entry('audio/theme.ogg', 'OGG'),
  ]

  it('FULL takes everything', async () => {
    const fs = new MemoryFileSystem()
    const result = await extractEntries(fs, pack(), '/t', ExtractMode.FULL)

    expect(result.written).toHaveLength(6)
    expect(await fs.exists('/t/audio/theme.ogg')).toBe(true)
  })

  it('INI_TXT takes the quest ini and localization only', async () => {
    const fs = new MemoryFileSystem()
    await extractEntries(fs, pack(), '/t', ExtractMode.INI_TXT)

    expect(await fs.exists('/t/quest.ini')).toBe(true)
    expect(await fs.exists('/t/Localization.English.txt')).toBe(true)
    expect(await fs.exists('/t/Localization.German.txt')).toBe(true)
    expect(await fs.exists('/t/cover.png')).toBe(false)
    expect(await fs.exists('/t/events.ini')).toBe(false)
  })

  it('INI_TXT_PIC also takes the image quest.ini names', async () => {
    const fs = new MemoryFileSystem()
    await extractEntries(fs, pack(), '/t', ExtractMode.INI_TXT_PIC)

    expect(await fs.exists('/t/quest.ini')).toBe(true)
    expect(await fs.readText('/t/cover.png')).toBe('PNG')
    expect(await fs.exists('/t/events.ini')).toBe(false)
  })

  it('INI_TXT_PIC copes with a quest.ini that names no image', async () => {
    const fs = new MemoryFileSystem()
    const entries = [entry('quest.ini', '[Quest]\nname=Test'), entry('cover.png', 'PNG')]
    await extractEntries(fs, entries, '/t', ExtractMode.INI_TXT_PIC)

    expect(await fs.exists('/t/cover.png')).toBe(false)
  })

  it('SAVE_INI_PIC takes a save and the quest it refers to', async () => {
    const fs = new MemoryFileSystem()
    const entries = [
      entry('save.ini', '[Save]'),
      entry('image.png', 'PNG'),
      entry('quest/quest.ini', '[Quest]'),
      entry('quest/Localization.English.txt', '.,English'),
      entry('quest/events.ini', '[EventA]'),
    ]
    await extractEntries(fs, entries, '/t', ExtractMode.SAVE_INI_PIC)

    expect(await fs.exists('/t/save.ini')).toBe(true)
    expect(await fs.exists('/t/image.png')).toBe(true)
    // The leading wildcard is what reaches into the subdirectory.
    expect(await fs.exists('/t/quest/quest.ini')).toBe(true)
    expect(await fs.exists('/t/quest/Localization.English.txt')).toBe(true)
    expect(await fs.exists('/t/quest/events.ini')).toBe(false)
  })

  it('a bare name matches only at the root, a wildcard reaches deeper', async () => {
    const fs = new MemoryFileSystem()
    await extractEntries(fs, [entry('sub/quest.ini')], '/t', ExtractMode.INI_TXT)
    expect(await fs.exists('/t/sub/quest.ini')).toBe(true)
  })
})

describe('extraction mechanics', () => {
  it('creates the target directory', async () => {
    const fs = new MemoryFileSystem()
    await extractEntries(fs, [], '/fresh/target')

    expect((await fs.stat('/fresh/target'))?.kind).toBe('directory')
  })

  it('recreates the archive directory structure', async () => {
    const fs = new MemoryFileSystem()
    await extractEntries(fs, [entry('a/b/c.txt', 'deep')], '/t')

    expect(await fs.readText('/t/a/b/c.txt')).toBe('deep')
  })

  it('skips directory entries', async () => {
    const fs = new MemoryFileSystem()
    const result = await extractEntries(fs, [entry('dir/', ''), entry('dir/a.txt', 'x')], '/t')

    expect(result.written).toEqual(['/t/dir/a.txt'])
  })

  it('reports progress', async () => {
    const fs = new MemoryFileSystem()
    const seen: number[] = []
    await extractEntries(
      fs,
      [entry('a'), entry('b'), entry('c'), entry('d')],
      '/t',
      ExtractMode.FULL,
      {
        onProgress: (fraction) => seen.push(fraction),
      },
    )

    expect(seen).toEqual([0.25, 0.5, 0.75, 1])
  })

  it('overwrites an existing file, as OverwriteSilently does', async () => {
    const fs = new MemoryFileSystem()
    await fs.writeText('/t/a.txt', 'old')
    await extractEntries(fs, [entry('a.txt', 'new')], '/t')

    expect(await fs.readText('/t/a.txt')).toBe('new')
  })

  it('reads a real zip', async () => {
    const entries = await readArchive(zipOf({ 'a.txt': 'one', 'b/c.txt': 'two' }))

    expect(entries.map((e) => e.name).sort()).toEqual(['a.txt', 'b/c.txt'])
  })

  it('rejects a corrupt archive instead of hanging', async () => {
    await expect(readArchive(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow()
  })
})

describe('questImageFromIni', () => {
  it('reads the image from the Quest section', async () => {
    const fs = new MemoryFileSystem()
    await fs.writeText('/t/quest.ini', '[Quest]\nname=X\nimage=cover.png\n')

    expect(await questImageFromIni(fs, '/t')).toBe('cover.png')
  })

  it('ignores an image key outside the Quest section', async () => {
    const fs = new MemoryFileSystem()
    await fs.writeText('/t/quest.ini', '[Other]\nimage=wrong.png\n[Quest]\nname=X\n')

    expect(await questImageFromIni(fs, '/t')).toBeNull()
  })

  it('returns null when there is no quest.ini', async () => {
    expect(await questImageFromIni(new MemoryFileSystem(), '/t')).toBeNull()
  })
})

describe('extractStream', () => {
  /** Feeds an archive in small chunks, as a network body would arrive. */
  async function* chunked(archive: Uint8Array, size = 7): AsyncGenerator<Uint8Array> {
    for (let at = 0; at < archive.length; at += size) yield archive.slice(at, at + size)
  }

  const PACK = {
    'quest.ini': '[Quest]\nimage=cover.png\nname=Test',
    'Localization.English.txt': '.,English\nKEY,value',
    'cover.png': 'PNG',
    'other.png': 'NOPE',
    'events.ini': '[EventA]',
    'audio/theme.ogg': 'OGG',
  }

  // The property that matters: streaming must not change what lands on disk.
  it.each([ExtractMode.FULL, ExtractMode.INI_TXT, ExtractMode.INI_TXT_PIC])(
    'agrees with buffered extraction for %s',
    async (mode) => {
      const archive = zipOf(PACK)

      const streamed = new MemoryFileSystem()
      await extractStream(streamed, chunked(archive), '/t', mode)

      const buffered = new MemoryFileSystem()
      await extract(buffered, archive, '/t', mode)

      const paths = async (fs: MemoryFileSystem): Promise<string[]> =>
        (await fs.list('/t', { recursive: true }))
          .filter((e) => e.kind === 'file')
          .map((e) => e.path)
          .sort()

      expect(await paths(streamed)).toEqual(await paths(buffered))
    },
  )

  it('takes the cover image even when it precedes quest.ini in the archive', async () => {
    // Reading forwards, the image is seen before its name is known.
    const archive = zipOf({
      'cover.png': 'PNG',
      'other.png': 'NOPE',
      'quest.ini': '[Quest]\nimage=cover.png',
    })
    const fs = new MemoryFileSystem()
    await extractStream(fs, chunked(archive), '/t', ExtractMode.INI_TXT_PIC)

    expect(await fs.readText('/t/cover.png')).toBe('PNG')
    expect(await fs.exists('/t/other.png')).toBe(false)
  })

  it('takes the cover image when it follows quest.ini', async () => {
    const archive = zipOf({ 'quest.ini': '[Quest]\nimage=cover.png', 'cover.png': 'PNG' })
    const fs = new MemoryFileSystem()
    await extractStream(fs, chunked(archive), '/t', ExtractMode.INI_TXT_PIC)

    expect(await fs.readText('/t/cover.png')).toBe('PNG')
  })

  it('blocks a traversing entry mid-stream', async () => {
    const archive = zipOf({ 'good.txt': 'good', '../evil.txt': 'evil' })
    const fs = new MemoryFileSystem()
    const result = await extractStream(fs, chunked(archive), '/t', ExtractMode.FULL)

    expect(result.blocked).toEqual(['../evil.txt'])
    expect(await fs.exists('/evil.txt')).toBe(false)
    expect(await fs.readText('/t/good.txt')).toBe('good')
  })

  it('reports progress against the declared size', async () => {
    const archive = zipOf({ 'a.txt': 'a'.repeat(200) })
    const seen: number[] = []
    await extractStream(new MemoryFileSystem(), chunked(archive, 16), '/t', ExtractMode.FULL, {
      totalBytes: archive.length,
      onProgress: (fraction) => seen.push(fraction),
    })

    expect(seen.length).toBeGreaterThan(1)
    expect(seen.at(-1)).toBe(1)
    expect(seen.every((f) => f >= 0 && f <= 1)).toBe(true)
    expect([...seen].sort((a, b) => a - b)).toEqual(seen)
  })

  it('accepts a legitimately empty archive', async () => {
    const result = await extractStream(new MemoryFileSystem(), chunked(zipOf({})), '/t')

    expect(result.written).toEqual([])
  })

  it('rejects a truncated stream', async () => {
    await expect(
      extractStream(new MemoryFileSystem(), chunked(new Uint8Array([0x50, 0x4b])), '/t'),
    ).rejects.toThrow(/truncated/)
  })

  it('rejects a corrupt stream', async () => {
    const bad = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
    await expect(
      extractStream(new MemoryFileSystem(), chunked(bad), '/t', ExtractMode.FULL),
    ).rejects.toThrow()
  })
})
