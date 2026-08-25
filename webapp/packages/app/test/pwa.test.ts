/**
 * @vitest-environment happy-dom
 *
 * Tests for the PWA layer (T-021).
 *
 * The behaviour that matters here is what happens to the user's data. An
 * update must not destroy a several-hundred-megabyte import, and must not
 * swap the app out mid-quest.
 */

import { describe, expect, it, vi } from 'vitest'

import { MemoryFileSystem, StoragePaths } from '@valkyrie/platform'
import { formatBytes, pressure, reclaim, storageReport } from '../src/storage.js'
import { CACHE_PREFIX, installServiceWorker, watchForUpdate } from '../src/serviceWorker.js'
import { persistenceMessage, persistenceState, requestPersistence } from '../src/persistence.js'

const paths = new StoragePaths({ appData: '/app', content: '/content', temp: '/tmp' }, 'MoM')

describe('storageReport', () => {
  async function populated(): Promise<MemoryFileSystem> {
    const fs = new MemoryFileSystem()
    await fs.writeBytes(`${paths.importPath}/img/a.webp`, new Uint8Array(1000))
    await fs.writeBytes(`${paths.customContentPackPath}/SOTP/x.ini`, new Uint8Array(200))
    await fs.writeBytes(`${paths.gameTypePath}/Save/saveAuto.vSave`, new Uint8Array(50))
    return fs
  }

  it('accounts for what is stored, by kind', async () => {
    const report = await storageReport(await populated(), paths)

    expect(report.entries.map((e) => e.id).sort()).toEqual(['contentPacks', 'import', 'saves'])
    expect(report.entries.find((e) => e.id === 'import')?.bytes).toBe(1000)
  })

  /**
   * Content packs live inside the download directory. Counting both without
   * excluding one tells the user they are using more space than they are.
   */
  it('does not count content packs twice under downloads', async () => {
    const fs = await populated()
    await fs.writeBytes(`${paths.downloadPath}/other.valkyrie`, new Uint8Array(70))
    const report = await storageReport(fs, paths)

    expect(report.entries.find((e) => e.id === 'downloads')?.bytes).toBe(70)
    expect(report.accountedBytes).toBe(1000 + 200 + 70 + 50)
  })

  it('omits kinds that hold nothing', async () => {
    const report = await storageReport(new MemoryFileSystem(), paths)

    expect(report.entries).toEqual([])
    expect(report.accountedBytes).toBe(0)
  })

  // Re-importing is slow but possible; losing saves loses progress outright.
  it('marks saves as not removable, and the import as removable', async () => {
    const report = await storageReport(await populated(), paths)

    expect(report.entries.find((e) => e.id === 'saves')?.removable).toBe(false)
    expect(report.entries.find((e) => e.id === 'import')?.removable).toBe(true)
  })

  it('reclaims a removable entry and reports what was freed', async () => {
    const fs = await populated()
    const report = await storageReport(fs, paths)

    expect(await reclaim(fs, report, 'import')).toBe(1000)
    expect(await fs.exists(`${paths.importPath}/img/a.webp`)).toBe(false)
  })

  it('refuses to reclaim saves', async () => {
    const fs = await populated()
    const report = await storageReport(fs, paths)

    await expect(reclaim(fs, report, 'saves')).rejects.toThrow(/progress/)
    expect(await fs.exists(`${paths.gameTypePath}/Save/saveAuto.vSave`)).toBe(true)
  })

  it('ignores an unknown entry', async () => {
    const fs = await populated()
    expect(await reclaim(fs, await storageReport(fs, paths), 'nope')).toBe(0)
  })
})

describe('formatBytes', () => {
  it.each([
    [512, '512 B'],
    [2048, '2 kB'],
    [5_400_000, '5.4 MB'],
    [2_100_000_000, '2.10 GB'],
  ])('formats %i as %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('pressure', () => {
  it('is the fraction of quota in use', () => {
    expect(pressure({ usage: 500, quota: 1000, persistent: false })).toBe(0.5)
  })

  // Several browsers report no quota. Inventing a number would be worse.
  it('is null when the browser reports no quota', () => {
    expect(pressure({ usage: 500, quota: null, persistent: false })).toBeNull()
    expect(pressure({ usage: null, quota: 1000, persistent: false })).toBeNull()
  })
})

describe('service worker', () => {
  /**
   * A cache storage good enough to observe what the worker does to it. The
   * spies are returned separately so assertions never reference a method off
   * the object, which reads as an unbound method.
   */
  function fakeCaches(existing: string[] = []) {
    const names = [...existing]
    const open = vi.fn(() =>
      Promise.resolve({
        addAll: vi.fn(() => Promise.resolve()),
        match: vi.fn(() => Promise.resolve(undefined)),
        put: vi.fn(() => Promise.resolve()),
      }),
    )
    const remove = vi.fn((name: string) => {
      const at = names.indexOf(name)
      if (at !== -1) names.splice(at, 1)
      return Promise.resolve(at !== -1)
    })
    const caches = {
      open,
      keys: vi.fn(() => Promise.resolve(names)),
      delete: remove,
      has: vi.fn(() => Promise.resolve(false)),
      match: vi.fn(() => Promise.resolve(undefined)),
    } as unknown as CacheStorage

    return { caches, open, remove, names }
  }

  function fakeScope(): {
    scope: Parameters<typeof installServiceWorker>[0]
    fire: (type: string, event: unknown) => Promise<void>
    skipWaiting: ReturnType<typeof vi.fn>
  } {
    const listeners = new Map<string, (event: never) => void>()
    const skipWaiting = vi.fn(() => Promise.resolve())
    const pending: Promise<unknown>[] = []

    return {
      skipWaiting,
      scope: {
        addEventListener: (type, listener) => {
          listeners.set(type, listener)
        },
        skipWaiting,
        clients: { claim: () => Promise.resolve() },
      },
      fire: async (type, event) => {
        const listener = listeners.get(type)
        listener?.(event as never)
        await Promise.all(pending)
      },
    }
  }

  it('caches the shell under a versioned name', async () => {
    const { caches, open } = fakeCaches()
    const { scope, fire } = fakeScope()
    installServiceWorker(scope, { version: '3.28', shell: ['/index.html'], caches })

    const waits: Promise<unknown>[] = []
    await fire('install', { waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)

    expect(open).toHaveBeenCalledWith(`${CACHE_PREFIX}3.28`)
  })

  /**
   * The user's import lives in OPFS, which the worker never touches. Only this
   * app's own older caches are removed — anything else in the origin is left
   * alone.
   */
  it('removes only its own older caches on activate', async () => {
    const { caches, remove } = fakeCaches([
      `${CACHE_PREFIX}3.27`,
      `${CACHE_PREFIX}3.28`,
      'something-else',
    ])
    const { scope, fire } = fakeScope()
    installServiceWorker(scope, { version: '3.28', shell: [], caches })

    const waits: Promise<unknown>[] = []
    await fire('activate', { waitUntil: (p: Promise<unknown>) => waits.push(p) })
    await Promise.all(waits)

    expect(remove).toHaveBeenCalledWith(`${CACHE_PREFIX}3.27`)
    expect(remove).not.toHaveBeenCalledWith('something-else')
    expect(remove).not.toHaveBeenCalledWith(`${CACHE_PREFIX}3.28`)
  })

  it('takes over only when the page asks', async () => {
    const { scope, fire, skipWaiting } = fakeScope()
    installServiceWorker(scope, { version: '3.28', shell: [], caches: fakeCaches().caches })

    await fire('message', { data: { type: 'SOMETHING_ELSE' } })
    expect(skipWaiting).not.toHaveBeenCalled()

    await fire('message', { data: { type: 'SKIP_WAITING' } })
    expect(skipWaiting).toHaveBeenCalledOnce()
  })
})

describe('watchForUpdate', () => {
  it('announces a worker that is already waiting', () => {
    const worker = { postMessage: vi.fn() } as unknown as ServiceWorker
    const registration = {
      waiting: worker,
      installing: null,
      addEventListener: vi.fn(),
    } as unknown as ServiceWorkerRegistration
    const onUpdate = vi.fn()

    watchForUpdate(registration, onUpdate, () => {})

    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ waiting: true }))
  })

  // The update is the user's choice: accepting is what triggers the swap.
  it('only swaps and reloads when accepted', () => {
    const postMessage = vi.fn()
    const worker = { postMessage } as unknown as ServiceWorker
    const registration = {
      waiting: worker,
      installing: null,
      addEventListener: vi.fn(),
    } as unknown as ServiceWorkerRegistration
    const reload = vi.fn()
    let status: { accept: () => void } | null = null

    watchForUpdate(registration, (s) => (status = s), reload)
    expect(reload).not.toHaveBeenCalled()

    ;(status as unknown as { accept: () => void }).accept()
    expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' })
    expect(reload).toHaveBeenCalledOnce()
  })

  it('says nothing when there is no update', () => {
    const registration = {
      waiting: null,
      installing: null,
      addEventListener: vi.fn(),
    } as unknown as ServiceWorkerRegistration
    const onUpdate = vi.fn()

    watchForUpdate(registration, onUpdate, () => {})

    expect(onUpdate).not.toHaveBeenCalled()
  })
})

describe('persistence', () => {
  it('reports an unsupported browser rather than guessing', async () => {
    expect(await persistenceState(undefined)).toEqual({ persisted: false, supported: false })
    expect(await requestPersistence(undefined)).toBe('unsupported')
  })

  it('does not ask again when already granted', async () => {
    const persist = vi.fn(() => Promise.resolve(true))
    const result = await requestPersistence({
      persist,
      persisted: () => Promise.resolve(true),
    })

    expect(result).toBe('already')
    expect(persist).not.toHaveBeenCalled()
  })

  it('reports a grant and a refusal differently', async () => {
    expect(
      await requestPersistence({
        persist: () => Promise.resolve(true),
        persisted: () => Promise.resolve(false),
      }),
    ).toBe('granted')
    expect(
      await requestPersistence({
        persist: () => Promise.resolve(false),
        persisted: () => Promise.resolve(false),
      }),
    ).toBe('refused')
  })

  // A refusal is not an error, and the message should not read like one.
  it('explains a refusal without alarming the user', () => {
    const message = persistenceMessage('refused')

    expect(message).toContain('usually will')
    expect(message).not.toMatch(/error|failed/i)
  })

  it.each(['granted', 'already', 'refused', 'unsupported'] as const)(
    'has something to say for %s',
    (result) => {
      expect(persistenceMessage(result).length).toBeGreaterThan(20)
    },
  )
})
