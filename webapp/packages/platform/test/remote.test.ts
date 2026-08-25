/**
 * Tests for the remote content-pack manager (T-013).
 *
 * The parsing half is pinned by `tools/differential/remote` against the real
 * C#. What is tested here is the orchestration around it: reconciling the
 * manifest with what is installed, and behaving sensibly offline.
 */

import { describe, expect, it } from 'vitest'
import { zipSync } from 'fflate'

import { MemoryFileSystem, StoragePaths } from '../src/filesystem.js'
import { NetworkError } from '../src/http.js'
import type { HttpClient } from '../src/http.js'
import { ListMode, RemoteContentPackManager, manifestUrl } from '../src/remote.js'
import { combine } from '../src/path.js'

const encoder = new TextEncoder()

const MANIFEST = `[DooM]
type=D2ECustom
image="contentpackicon.png"
version=1.1
name.English=DooM
description.English=A conversion kit.
url=https://packs.invalid/doom/
latest_update=2026-03-07T05:32:25Z

[SOTP]
type=D2ECustom
version=1.2
name.English=SOTP
url=https://packs.invalid/sotp/
`

/** Serves fixed responses, and records what was asked for. */
class FakeHttp implements HttpClient {
  readonly requested: string[] = []

  constructor(private readonly responses: Record<string, string | Uint8Array | Error>) {}

  private lookup(url: string): string | Uint8Array {
    this.requested.push(url)
    const found = this.responses[url]
    if (found === undefined) throw new NetworkError(url)
    if (found instanceof Error) throw found
    return found
  }

  async getText(url: string): Promise<string> {
    const value = this.lookup(url)
    return typeof value === 'string' ? value : new TextDecoder().decode(value)
  }

  async getBytes(url: string): Promise<Uint8Array> {
    const value = this.lookup(url)
    return typeof value === 'string' ? encoder.encode(value) : value
  }

  async *getStream(url: string): AsyncIterable<Uint8Array> {
    yield await this.getBytes(url)
  }
}

const paths = new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'D2E')

function makeManager(responses: Record<string, string | Uint8Array | Error>): {
  manager: RemoteContentPackManager
  fs: MemoryFileSystem
  http: FakeHttp
} {
  const fs = new MemoryFileSystem()
  const http = new FakeHttp(responses)
  const manager = new RemoteContentPackManager({ fs, http, paths, gameType: 'D2E' })
  return { manager, fs, http }
}

const withManifest = (extra: Record<string, string | Uint8Array | Error> = {}) => ({
  [manifestUrl('D2E')]: MANIFEST,
  ...extra,
})

describe('manifestUrl', () => {
  it.each(['D2E', 'MoM'] as const)('points at the %s manifest in valkyrie-store', (game) => {
    expect(manifestUrl(game)).toBe(
      `https://raw.githubusercontent.com/NPBruce/valkyrie-store/refs/heads/master/${game}/contentPacksManifestDownload.ini`,
    )
  })
})

describe('refresh', () => {
  it('parses the manifest into packs and goes online', async () => {
    const { manager } = makeManager(withManifest())

    expect(await manager.refresh()).toBe(ListMode.ONLINE)
    expect([...manager.packs.keys()]).toEqual(['DooM', 'SOTP'])
    expect(manager.packs.get('DooM')?.getTitle('English')).toBe('DooM')
    expect(manager.packs.get('DooM')?.image).toBe('contentpackicon.png')
  })

  it('reports an empty manifest as an error', async () => {
    const { manager } = makeManager({ [manifestUrl('D2E')]: '' })

    expect(await manager.refresh()).toBe(ListMode.ERROR_DOWNLOAD)
    expect(manager.errorDescription).toBe('ERROR: Quest list is empty')
  })

  it('marks installed packs and detects an available update', async () => {
    const { manager, fs } = makeManager(withManifest())
    await fs.writeText(
      combine(paths.customContentPackPath, 'manifest.ini'),
      '[DooM]\nversion=1.0\n[SOTP]\nversion=1.2\n',
    )

    await manager.refresh()

    expect(manager.packs.get('DooM')?.downloaded).toBe(true)
    expect(manager.packs.get('DooM')?.updateAvailable).toBe(true)
    expect(manager.packs.get('SOTP')?.updateAvailable).toBe(false)
    expect(manager.updatable().map((p) => p.identifier)).toEqual(['DooM'])
  })
})

describe('offline behaviour (DEVIATION)', () => {
  // The C# leaves the pack list empty when the manifest cannot be fetched, so
  // the screen is blank even for content already on disk.
  it('keeps installed packs listed and playable with no network', async () => {
    const { manager, fs } = makeManager({})
    await fs.writeText(
      combine(paths.customContentPackPath, 'manifest.ini'),
      '[DooM]\nversion=1.1\nname.English=DooM\nurl=https://packs.invalid/doom/\n',
    )

    expect(await manager.refresh()).toBe(ListMode.LOCAL)
    expect(manager.installed().map((p) => p.identifier)).toEqual(['DooM'])
    expect(manager.packs.get('DooM')?.getTitle('English')).toBe('DooM')
    expect(manager.errorDescription).toBe('ERROR NETWORK')
  })

  it('reports an error when offline with nothing installed', async () => {
    const { manager } = makeManager({})

    expect(await manager.refresh()).toBe(ListMode.ERROR_DOWNLOAD)
    expect(manager.packs.size).toBe(0)
  })
})

describe('download', () => {
  const packageUrl = 'https://packs.invalid/doom/DooM.valkyrieContentPack'

  it('composes the package url the way the C# does', async () => {
    const { manager } = makeManager(withManifest())
    await manager.refresh()

    expect(manager.packageUrl('DooM')).toBe(packageUrl)
  })

  it('refuses an identifier that is not in the manifest', async () => {
    const { manager } = makeManager(withManifest())
    await manager.refresh()

    expect(() => manager.packageUrl('Nope')).toThrow(/Could not find key Nope/)
  })

  it('extracts the package and records it as installed', async () => {
    const archive = zipSync({
      'content_pack.ini': encoder.encode('[ContentPack]\nname=DooM\n'),
      'img/tile.png': encoder.encode('PNG'),
    })
    const { manager, fs } = makeManager(withManifest({ [packageUrl]: archive }))
    await manager.refresh()

    const target = await manager.download('DooM')

    expect(await fs.readText(combine(target, 'content_pack.ini'))).toBe(
      '[ContentPack]\nname=DooM\n',
    )
    expect(await fs.exists(combine(target, 'img/tile.png'))).toBe(true)
    expect(manager.packs.get('DooM')?.downloaded).toBe(true)
    expect(manager.packs.get('DooM')?.updateAvailable).toBe(false)
  })

  it('writes a local manifest a later run can read back', async () => {
    const archive = zipSync({ 'content_pack.ini': encoder.encode('[ContentPack]\n') })
    const { manager, fs, http } = makeManager(withManifest({ [packageUrl]: archive }))
    await manager.refresh()
    await manager.download('DooM')

    const second = new RemoteContentPackManager({ fs, http, paths, gameType: 'D2E' })
    await second.refresh()

    expect(second.packs.get('DooM')?.downloaded).toBe(true)
    expect(second.packs.get('DooM')?.updateAvailable).toBe(false)
  })

  it('flags an update after the manifest version moves on', async () => {
    const archive = zipSync({ 'content_pack.ini': encoder.encode('[ContentPack]\n') })
    const { manager, fs } = makeManager(withManifest({ [packageUrl]: archive }))
    await manager.refresh()
    await manager.download('DooM')

    const newer = new RemoteContentPackManager({
      fs,
      http: new FakeHttp({ [manifestUrl('D2E')]: MANIFEST.replace('version=1.1', 'version=1.2') }),
      paths,
      gameType: 'D2E',
    })
    await newer.refresh()

    expect(newer.packs.get('DooM')?.updateAvailable).toBe(true)
  })

  it('blocks a traversing entry inside a downloaded package', async () => {
    // These packages come from arbitrary GitHub repositories named by the
    // manifest, so the entry names are untrusted.
    const archive = zipSync({
      'content_pack.ini': encoder.encode('[ContentPack]\n'),
      '../evil.ini': encoder.encode('bad'),
    })
    const { manager, fs } = makeManager(withManifest({ [packageUrl]: archive }))
    await manager.refresh()
    const target = await manager.download('DooM')

    // One level up from the pack directory is where it would have landed.
    expect(await fs.exists(combine(paths.customContentPackPath, 'evil.ini'))).toBe(false)
    expect(await fs.exists(combine(target, 'content_pack.ini'))).toBe(true)
  })
})

describe('setAvailability', () => {
  it('removes the pack and its files when set unavailable', async () => {
    const archive = zipSync({ 'content_pack.ini': encoder.encode('[ContentPack]\n') })
    const { manager, fs } = makeManager(
      withManifest({ 'https://packs.invalid/doom/DooM.valkyrieContentPack': archive }),
    )
    await manager.refresh()
    const target = await manager.download('DooM')

    await manager.setAvailability('DooM', false)

    expect(await fs.exists(combine(target, 'content_pack.ini'))).toBe(false)
    expect(manager.packs.get('DooM')?.downloaded).toBe(false)
    expect(manager.installed()).toEqual([])
  })
})
