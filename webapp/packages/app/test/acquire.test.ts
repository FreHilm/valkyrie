/**
 * Tests for getting a scenario onto the device (T-018).
 *
 * The Unity app downloads a package, extracts it beside the others and
 * rescans. The interesting cases are the ones it does not handle: a package
 * that is not a scenario, one that tries to write outside its folder, and an
 * extraction that fails halfway and leaves something that looks installed.
 */

import { describe, expect, it, vi } from 'vitest'

import { MemoryFileSystem } from '@valkyrie/platform'
import type { HttpClient } from '@valkyrie/platform'
import { zipSync } from 'fflate'

import { acquireQuest, questIdFromUrl } from '../src/acquire.js'

function archive(files: Record<string, string>): Uint8Array {
  const encoder = new TextEncoder()
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([name, body]) => [name, encoder.encode(body)])),
  )
}

function http(bytes: Uint8Array | (() => never)): HttpClient {
  return {
    getText: async () => '',
    getBytes: async () => (typeof bytes === 'function' ? bytes() : bytes),
    getStream: async function* () {
      /* not used here */
    },
  }
}

const QUEST = '[Quest]\nformat=18\ntype=MoM\n'

describe('questIdFromUrl', () => {
  it('takes the package name without its extension', () => {
    expect(questIdFromUrl('https://example.test/a/b/MoM__Lynch.valkyrie')).toBe('MoM__Lynch')
  })

  it('ignores a query string and a fragment', () => {
    expect(questIdFromUrl('https://example.test/Lynch.valkyrie?v=2#top')).toBe('Lynch')
  })

  it('decodes an escaped name', () => {
    expect(questIdFromUrl('https://example.test/The%20Fall.valkyrie')).toBe('The Fall')
  })
})

describe('acquireQuest', () => {
  const options = (fs: MemoryFileSystem, client: HttpClient) => ({
    fs,
    http: client,
    questRoot: '/download',
  })

  it('extracts a package into its own directory', async () => {
    const fs = new MemoryFileSystem()
    const result = await acquireQuest(
      'https://example.test/Lynch.valkyrie',
      options(fs, http(archive({ 'quest.ini': QUEST, 'events.ini': '[EventIntro]\n' }))),
    )

    expect(result.path).toBe('/download/Lynch')
    expect(result.files).toBe(2)
    expect(await fs.exists('/download/Lynch/quest.ini')).toBe(true)
  })

  it('refuses a package with no quest.ini', async () => {
    const fs = new MemoryFileSystem()

    await expect(
      acquireQuest(
        'https://example.test/NotAQuest.valkyrie',
        options(fs, http(archive({ 'readme.txt': 'hello' }))),
      ),
    ).rejects.toThrow('no quest.ini')
  })

  it('leaves nothing behind when it refuses', async () => {
    // Half a scenario looks installed and fails later, somewhere less
    // obviously connected to the download.
    const fs = new MemoryFileSystem()
    await acquireQuest(
      'https://example.test/Bad.valkyrie',
      options(fs, http(archive({ 'readme.txt': 'hello' }))),
    ).catch(() => undefined)

    expect(await fs.exists('/download/Bad')).toBe(false)
  })

  it('refuses an empty package', async () => {
    const fs = new MemoryFileSystem()

    await expect(
      acquireQuest('https://example.test/Empty.valkyrie', options(fs, http(archive({})))),
    ).rejects.toThrow('empty')
  })

  it('replaces a previous attempt rather than merging into it', async () => {
    // Old files blended into a new package read as a corrupt scenario rather
    // than a failed download.
    const fs = new MemoryFileSystem()
    await fs.writeText('/download/Lynch/stale.ini', '[Gone]\n')

    await acquireQuest(
      'https://example.test/Lynch.valkyrie',
      options(fs, http(archive({ 'quest.ini': QUEST }))),
    )

    expect(await fs.exists('/download/Lynch/stale.ini')).toBe(false)
  })

  it('refuses a package that tries to escape its own folder', async () => {
    const fs = new MemoryFileSystem()

    await expect(
      acquireQuest(
        'https://example.test/Evil.valkyrie',
        options(fs, http(archive({ 'quest.ini': QUEST, '../../escaped.ini': 'x' }))),
      ),
    ).rejects.toThrow('outside its own folder')
    expect(await fs.exists('/escaped.ini')).toBe(false)
  })

  it('propagates a failed download without leaving a directory', async () => {
    const fs = new MemoryFileSystem()
    const failing = http(() => {
      throw new Error('offline')
    })

    await expect(
      acquireQuest('https://example.test/Lynch.valkyrie', options(fs, failing)),
    ).rejects.toThrow('offline')
    expect(await fs.exists('/download/Lynch')).toBe(false)
  })

  it('reports progress while downloading', async () => {
    const onProgress = vi.fn()
    const fs = new MemoryFileSystem()
    const client: HttpClient = {
      getText: async () => '',
      getBytes: async (_url, requestOptions) => {
        requestOptions?.onProgress?.(0.5, 512, 1024)
        return archive({ 'quest.ini': QUEST })
      },
      getStream: async function* () {},
    }

    await acquireQuest('https://example.test/Lynch.valkyrie', {
      ...options(fs, client),
      onProgress,
    })

    expect(onProgress).toHaveBeenCalledWith(0.5, 512, 1024)
  })
})
