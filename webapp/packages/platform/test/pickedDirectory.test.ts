/**
 * Tests for reading a user-picked directory (T-014/T-018).
 *
 * In a browser the only way to read a licensed install is a directory the user
 * hands over, which grants read access to that directory alone. What is
 * asserted here is that the adapter presents it the way the import already
 * expects a path on disk to look — and that it reads, never writes.
 */

import { describe, expect, it } from 'vitest'

import {
  CompositeAssetSource,
  isUnityAsset,
  PickedDirectorySource,
} from '../src/pickedDirectory.js'
import type { PickedDirectory } from '../src/pickedDirectory.js'

/** A directory handle over a plain object tree. */
function directory(name: string, tree: Record<string, string | object>): PickedDirectory {
  return {
    name,
    async *entries() {
      for (const [key, value] of Object.entries(tree)) {
        yield [
          key,
          typeof value === 'string'
            ? {
                kind: 'file' as const,
                getFile: async () => ({
                  size: value.length,
                  arrayBuffer: async () => new TextEncoder().encode(value).buffer,
                }),
              }
            : Object.assign(directory(key, value as Record<string, string | object>), {
                kind: 'directory' as const,
              }),
        ] as never
      }
    },
    async getDirectoryHandle(child: string) {
      const value = tree[child]
      if (typeof value !== 'object') throw new Error(`no directory ${child}`)
      return directory(child, value as Record<string, string | object>)
    },
    async getFileHandle(child: string) {
      const value = tree[child]
      if (typeof value !== 'string') throw new Error(`no file ${child}`)
      return {
        kind: 'file' as const,
        getFile: async () => ({
          size: value.length,
          arrayBuffer: async () => new TextEncoder().encode(value).buffer,
        }),
      }
    },
  }
}

describe('PickedDirectorySource', () => {
  it('lists the files in the picked directory', async () => {
    const source = new PickedDirectorySource(
      directory('Data', { 'resources.assets': 'a', level0: 'b' }),
    )

    expect(await source.list()).toEqual(['level0', 'resources.assets'])
  })

  it('reads a file by the name it listed', async () => {
    const source = new PickedDirectorySource(directory('Data', { 'resources.assets': 'hello' }))
    const bytes = await source.read('resources.assets')

    expect(new TextDecoder().decode(bytes)).toBe('hello')
  })

  it('descends by default, because the download cache nests its bundles', async () => {
    // Every bundle in the cache is called `__data`, two directories deep. A
    // flat walk finds none of them — which silently cost 425 of 1,158
    // textures while the import reported success.
    const source = new PickedDirectorySource(
      directory('cache', { mad22: { abc123: { __data: 'bundle', __info: 'meta' } } }),
    )

    // No filter here, so the sidecar is listed too; isUnityAsset excludes it.
    expect(await source.list()).toEqual(['mad22/abc123/__data', 'mad22/abc123/__info'])
  })

  it('can be told not to descend', async () => {
    const source = new PickedDirectorySource(
      directory('Data', { 'resources.assets': 'a', Managed: { 'Assembly.dll': 'x' } }),
      { recursive: false },
    )

    expect(await source.list()).toEqual(['resources.assets'])
  })

  it('keeps names relative to the picked directory', async () => {
    const source = new PickedDirectorySource(
      directory('Data', { StreamingAssets: { 'content.ini': 'x' } }),
    )

    expect(await source.list()).toEqual(['StreamingAssets/content.ini'])
    expect(new TextDecoder().decode(await source.read('StreamingAssets/content.ini'))).toBe('x')
  })

  it('filters to what the caller accepts', async () => {
    const source = new PickedDirectorySource(
      directory('Data', { 'resources.assets': 'a', 'UnityPlayer.dll': 'b' }),
      { accept: isUnityAsset },
    )

    expect(await source.list()).toEqual(['resources.assets'])
  })

  it('accepts the download cache’s bundles through the same filter', async () => {
    const source = new PickedDirectorySource(
      directory('cache', { mad22: { abc: { __data: 'bundle', __info: 'meta' } } }),
      { accept: isUnityAsset },
    )

    expect(await source.list()).toEqual(['mad22/abc/__data'])
  })

  it('lists once, however often it is asked', async () => {
    let walks = 0
    const tree = directory('Data', { a: '1' })
    const counting: PickedDirectory = {
      ...tree,
      async *entries() {
        walks++
        yield* tree.entries()
      },
    }
    const source = new PickedDirectorySource(counting)
    await source.list()
    await source.list()

    expect(walks).toBe(1)
  })

  it('reports the total size, for saying how much is about to be read', async () => {
    const source = new PickedDirectorySource(directory('Data', { a: '12345', b: '123' }))

    expect(await source.size()).toBe(8)
  })

  it('names the directory that was opened', () => {
    expect(new PickedDirectorySource(directory('Mansions Data', {})).name).toBe('Mansions Data')
  })
})

describe('isUnityAsset', () => {
  it('accepts the containers an import reads', () => {
    for (const name of [
      'resources.assets',
      'sharedassets0.assets',
      'globalgamemanagers',
      'level0',
      'resources.assets.resS',
      'sharedassets1.resource',
    ]) {
      expect(isUnityAsset(name)).toBe(true)
    }
  })

  it('accepts the download cache’s bundles, which are all called __data', () => {
    // A tight allow-list of install container names excluded these entirely.
    expect(isUnityAsset('mad22/abc123/__data')).toBe(true)
    expect(isUnityAsset('__data')).toBe(true)
  })

  it('rejects the cache’s metadata sidecar', () => {
    expect(isUnityAsset('mad22/abc123/__info')).toBe(false)
  })

  it('rejects what is obviously not an asset', () => {
    for (const name of ['UnityPlayer.dll', 'boot.config', 'app.info', 'Managed/Assembly.dll']) {
      expect(isUnityAsset(name)).toBe(false)
    }
  })
})

describe('CompositeAssetSource', () => {
  it('presents several folders as one', async () => {
    // Mansions 2.1.6 downloads most of its board art on first run, so
    // importing only the install loses a third of the textures — and reports
    // success while doing it.
    const install = new PickedDirectorySource(directory('Data', { 'resources.assets': 'a' }))
    const cache = new PickedDirectorySource(
      directory('cache', { mad22: { abc: { __data: 'bundle' } } }),
    )
    const both = new CompositeAssetSource([install, cache])

    expect(await both.list()).toEqual(['mad22/abc/__data', 'resources.assets'])
  })

  it('reads from whichever folder holds the file', async () => {
    const install = new PickedDirectorySource(
      directory('Data', { 'resources.assets': 'from-install' }),
    )
    const cache = new PickedDirectorySource(directory('cache', { extra: 'from-cache' }))
    const both = new CompositeAssetSource([install, cache])

    expect(new TextDecoder().decode(await both.read('extra'))).toBe('from-cache')
  })

  it('lets downloaded content override what shipped', async () => {
    const install = new PickedDirectorySource(directory('Data', { shared: 'old' }))
    const cache = new PickedDirectorySource(directory('cache', { shared: 'new' }))
    const both = new CompositeAssetSource([install, cache])

    expect(new TextDecoder().decode(await both.read('shared'))).toBe('new')
  })

  it('is empty with no folders', async () => {
    expect(await new CompositeAssetSource([]).list()).toEqual([])
  })
})
