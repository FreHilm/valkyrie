/**
 * Tests for reading a user-picked directory (T-014/T-018).
 *
 * In a browser the only way to read a licensed install is a directory the user
 * hands over, which grants read access to that directory alone. What is
 * asserted here is that the adapter presents it the way the import already
 * expects a path on disk to look — and that it reads, never writes.
 */

import { describe, expect, it } from 'vitest'

import { isUnityAsset, PickedDirectorySource } from '../src/pickedDirectory.js'
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

  it('does not descend by default, because a data folder is flat', async () => {
    const source = new PickedDirectorySource(
      directory('Data', { 'resources.assets': 'a', Managed: { 'Assembly.dll': 'x' } }),
    )

    expect(await source.list()).toEqual(['resources.assets'])
  })

  it('descends when asked, keeping names relative to the picked directory', async () => {
    const source = new PickedDirectorySource(
      directory('Data', { StreamingAssets: { 'content.ini': 'x' } }),
      { recursive: true },
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

  it('rejects everything else, so the import does not look bigger than it is', () => {
    for (const name of ['UnityPlayer.dll', 'boot.config', 'app.info', 'Assembly-CSharp.dll']) {
      expect(isUnityAsset(name)).toBe(false)
    }
  })
})
